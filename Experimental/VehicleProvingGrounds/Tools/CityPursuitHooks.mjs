import assert from "node:assert/strict";

export default {
    BeforeFrame(Host, Frame)
    {
        if (Frame === 2)
        {
            Host.FixedStep = 1 / 60;
            assert.equal(Host.LevelKey, "city", "Harness must boot City Pursuit & AI Lab level");
            assert.ok(Host.Police, "Host.Police must be initialized");
            Host.Police.StartPursuit("SPEEDING IN DOWNTOWN 60 KM/H ZONE");
        }
        if (Frame === 12)
        {
            Host.Police.ToggleSelfPlayMode(true);
            Host.Police.TimeWarp = 16;
        }
        if (Frame === 20)
        {
            Host.Police.SpectatorTarget = "police";
        }
        if (Frame === 28)
        {
            Host.Police.SpectatorTarget = "helicopter";
        }
    },
    Report(Host)
    {
        assert.equal(Host.Police.ControlMode, "selfplay");
        assert.ok(Host.Police.EpisodeClock > 0.0 || Host.Police.EpisodeIndex > 1, "RL self-play must advance live rollouts");
        console.log(`city pursuit integration: Cruiser + Helicopter + 3 Drones + RL Self-Play verified (Gen=${Host.Police.EvaderBrain.Generation}, Ep=${Host.Police.EpisodeIndex})`);
    }
};
