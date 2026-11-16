// Boot: the shared studio stage, the Lobby level (environment, ControlVehicle, configurator dots) and the Level
// Designer workspace around it.
//   ?play=1            open straight into the Lobby (no editor interface)
//   ?tier=premium      start as a Premium designer
//   ?fresh=1           forget every level saved in this browser
//   ?level=<id>        open a level from the browser's level library
//   ?focus=wheels      open a configurator part (paint, wheels, glass, wing, lights, trim)
//   ?guests=0..4       simulated players already in the lobby (default 3)
//   ?company=1         simulated players keep coming, repainting and leaving
import { $, toast } from '../Shared/Studio/Ui.js';
import { Stage } from '../Shared/Studio/Render.js';
import { Level, STORAGE_KEY, LIBRARY_KEY } from './Level.js';
import { createLevelDesigner } from './LevelDesigner.js';

const params = new URLSearchParams(location.search);
if (params.has('fresh')) { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LIBRARY_KEY); }

const stage = new Stage($('Viewport'), { background: '#cfd8e2', grid: false, shadows: true });
const level = new Level(stage, $('ViewportWell'));

(async () => {
  const boot = $('Boot');
  const report = (text, f) => { $('BootText').textContent = text; $('BootBar').style.width = `${Math.round(f * 100)}%`; };
  try {
    await level.load(report, params.get('level'));
    report(`Dressing ${level.name}`, 1);
    if (params.get('tier') === 'premium') level.tier = 'premium';
    const designer = createLevelDesigner({ stage, level });
    const guests = Math.max(0, Math.min(4, Number(params.get('guests') ?? 3)));
    for (let i = 0; i < guests; i++) level.addGuest();
    if (params.has('company')) level.sim.auto = true;
    designer.heroView(0);
    window.FrontierLevelDesigner = designer;
    boot.classList.add('done');
    setTimeout(() => boot.remove(), 400);
    if (params.has('play')) designer.setPlaying(true);
    if (params.get('focus')) setTimeout(() => designer.focusZone(params.get('focus')), 300);
    if (!params.has('play')) toast(`${level.name} ready · ${level.session.count} of 5 cars · press P to play`);
  } catch (error) {
    console.error(error);
    $('BootText').textContent = `Could not open the Lobby: ${error.message}`;
    boot.classList.add('failed');
  }
})();
