import assert from "node:assert/strict";
import { IdentityCeiling } from "../Source/FacetStructure.js";
import { DDayWallReachX, DDayDriveInShelters } from "../Source/DDayStructure.js";

let TankStartX = null;
let SawBombDrop = false;
let SawTankExplosion = false;
let SawCoverActive = false;
let SawMineBlast = false;
let SawCarSmash = false;

export default {
    BeforeFrame(Host, Frame)
    {
        if (Frame === 0)
        {
            Host.FixedStep = 1.0 / 60.0;
            assert.equal(Host.LevelKey, "dday", "DDayHooks must boot into level=dday");
            assert.ok(Host.DDay, "Host.DDay battle sequence must exist");
            assert.ok(Host.Scene.Occupants.length <= IdentityCeiling,
                      `Occupant count ${Host.Scene.Occupants.length} exceeds ${IdentityCeiling}`);
            assert.equal(Host.Lighting.ScrollingGrid, true, "Scrolling cluster grid must be enabled for D-Day beachhead");
            TankStartX = Host.DDay.Tanks[0].Position[0];
        }

        // Frame 6: Trigger manual Air Strike + step into Drive-In Shelter to confirm cover mechanics
        if (Frame === 6)
        {
            const Shelter = DDayDriveInShelters[0];
            Host.Vehicle.Respawn([Shelter.CX, Shelter.CY, 0.65], 0.0);
            Host.DDay.TriggerManualAirStrike();
            SawBombDrop = Host.DDay.BombsDropped >= 3;
        }

        if (Frame === 14)
        {
            SawCoverActive = Host.DDay.PlayerInCover && Host.DDay.PlayerUnderAirCover;
        }

        // Frame 22: Detonate one tank from incoming ordnance & trigger a beachhead landmine
        if (Frame === 22)
        {
            const Tk = Host.DDay.Tanks[1];
            Host.DDay.DamageTank(Tk, Tk.Hp + 10.0);
            SawTankExplosion = !Tk.Alive && Host.DDay.TanksExploded >= 1;

            const Mine = Host.DDay.Mines[2];
            Host.Vehicle.Respawn([Mine.Position[0], Mine.Position[1], 0.65], 0.0);
        }

        if (Frame === 26)
        {
            SawMineBlast = Host.DDay.MinesTriggered >= 1;
        }

        // Frame 34: High-speed crash into Enemy Military Patrol Car 0
        if (Frame === 34)
        {
            const Enemy = Host.DDay.EnemyCars[0];
            Enemy.Position = [10.0, 0.0, 0.65];
            Enemy.Velocity = [0.0, 0.0, 0.0];
            Enemy.Hp = 35.0;
            Host.Vehicle.Respawn([7.8, 0.0, 0.65], 0.0);
            Host.Vehicle.LinearVelocity = [26.0, 0.0, 0.0];
        }

        if (Frame === 38)
        {
            SawCarSmash = Host.DDay.CarsSmashed >= 1;
        }

        // Frame 46: Drive through the Atlantic Wall Breach Archway!
        if (Frame === 46)
        {
            Host.Vehicle.Respawn([DDayWallReachX + 2.0, 0.0, 0.65], 0.0);
            Host.ScriptedInput = { Throttle: 0.7, Brake: 0.0, Steer: 0.0, Handbrake: false };
        }
    },

    Report(Host)
    {
        assert.ok(Host.DDay.Tanks[0].Position[0] > TankStartX, "Allied tank must advance East toward Atlantic Wall");
        assert.ok(SawBombDrop, "Aircraft bombs must deploy");
        assert.ok(SawCoverActive, "Drive-in shelter must register ground & air cover");
        assert.ok(SawTankExplosion, "Tanks must take fire and explode");
        assert.ok(SawMineBlast, "Landmines must detonate under vehicles");
        assert.ok(SawCarSmash, "Enemy military cars must crash and wreck");
        assert.equal(Host.DDay.WallReached, true, "Reaching the Atlantic Wall breach gate must complete the level objective");
        console.log(`dday assault validation: Tanks=${Host.DDay.Tanks.filter((T) => T.Alive).length}/${Host.DDay.Tanks.length}, Bombs=${Host.DDay.BombsDropped}, Mines=${Host.DDay.MinesTriggered}, Smashed=${Host.DDay.CarsSmashed}, WallBreached=${Host.DDay.WallReached}`);
    }
};
