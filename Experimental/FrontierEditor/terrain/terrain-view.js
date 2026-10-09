// 3-D viewport for the terrain editor. The ground is a regular grid built straight from the heightfield, with
// vertex colours from the texture stack. Water is a separate surface drawn only where a cell's ground sits below
// its water level, so a river is a cut in the ground with water in it, never a tinted patch of dry land.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function createTerrainView(container) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x141414, 1);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 20000);
    camera.position.set(900, 700, 900);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xcfd8e3, 0x2a2622, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.position.set(-600, 900, 400);
    scene.add(sun);

    const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x2f6f86, roughness: 0.18, metalness: 0.02, transparent: true, opacity: 0.86, side: THREE.DoubleSide });
    let terrainMesh = null, waterMesh = null;

    function resize() {
        const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let frame = 0;
    const tick = () => {
        frame = requestAnimationFrame(tick);
        controls.update();
        renderer.render(scene, camera);
    };
    tick();

    // Replace the mesh for a new evaluation. `result` is evaluateTerrain's output, `rgb` the texture stack.
    function setTerrain(result, rgb) {
        const { N, cell, size, height, water } = result;
        const half = size / 2;

        const pos = new Float32Array(N * N * 3);
        const col = new Float32Array(N * N * 3);
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const k = j * N + i;
            pos[k * 3] = i * cell - half;
            pos[k * 3 + 1] = height[k];
            pos[k * 3 + 2] = j * cell - half;
            if (rgb) { col[k * 3] = rgb[k * 3]; col[k * 3 + 1] = rgb[k * 3 + 1]; col[k * 3 + 2] = rgb[k * 3 + 2]; }
            else { col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = 0.6; }
        }
        const index = [];
        for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
            const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
            index.push(a, c, b, b, c, d);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geometry.setIndex(index);
        geometry.computeVertexNormals();
        if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); }
        terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
        scene.add(terrainMesh);

        // water: one flat quad per cell whose four corners are all wet, at the mean of their levels
        const wp = [];
        for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
            const corners = [j * N + i, j * N + i + 1, (j + 1) * N + i, (j + 1) * N + i + 1];
            if (!corners.every((k) => !Number.isNaN(water[k]))) continue;
            const y = corners.reduce((s, k) => s + water[k], 0) / 4;
            const x0 = i * cell - half, x1 = x0 + cell, z0 = j * cell - half, z1 = z0 + cell;
            wp.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
        }
        if (waterMesh) { scene.remove(waterMesh); waterMesh.geometry.dispose(); waterMesh = null; }
        if (wp.length) {
            const wg = new THREE.BufferGeometry();
            wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
            wg.computeVertexNormals();
            waterMesh = new THREE.Mesh(wg, waterMaterial);
            scene.add(waterMesh);
        }
        return { wetTriangles: wp.length / 9 };
    }

    function dispose() {
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
    }

    return { setTerrain, dispose };
}
