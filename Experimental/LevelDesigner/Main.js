// Boot: the shared studio stage, the Lobby level (environment, ControlVehicle, configurator dots) and the Level
// Designer workspace around it.
//   ?play=1            open straight into the Lobby (no editor interface)
//   ?tier=premium      start as a Premium designer
//   ?fresh=1           ignore the level saved in this browser
//   ?focus=wheels      open a configurator part (paint, wheels, glass, wing, lights, trim)
import { $, toast } from '../Shared/Studio/Ui.js';
import { Stage } from '../Shared/Studio/Render.js';
import { Level, STORAGE_KEY } from './Level.js';
import { createLevelDesigner } from './LevelDesigner.js';

const params = new URLSearchParams(location.search);
if (params.has('fresh')) localStorage.removeItem(STORAGE_KEY);

const stage = new Stage($('Viewport'), { background: '#cfd8e2', grid: false, shadows: true });
const level = new Level(stage, $('ViewportWell'));

(async () => {
  const boot = $('Boot');
  const report = (text, f) => { $('BootText').textContent = text; $('BootBar').style.width = `${Math.round(f * 100)}%`; };
  try {
    await level.load(report);
    report('Dressing the Lobby', 1);
    if (params.get('tier') === 'premium') level.tier = 'premium';
    const designer = createLevelDesigner({ stage, level });
    designer.heroView(0);
    window.FrontierLevelDesigner = designer;
    boot.classList.add('done');
    setTimeout(() => boot.remove(), 400);
    if (params.has('play')) designer.setPlaying(true);
    if (params.get('focus')) setTimeout(() => designer.focusZone(params.get('focus')), 300);
    if (!params.has('play')) toast(`Lobby ready · ${level.counts.hotspots} configurator dots · press P to play`);
  } catch (error) {
    console.error(error);
    $('BootText').textContent = `Could not open the Lobby: ${error.message}`;
    boot.classList.add('failed');
  }
})();
