// --- DOMContentLoaded listener for loading screen MOVED TO TOP ---
document.addEventListener('DOMContentLoaded', () => {
  // This listener primarily ensures the div exists. Hiding is done in main().
  const loadingOverlay = document.getElementById('loading-overlay');
  if (!loadingOverlay) {
    console.error('[Main] Loading overlay element not found!');
  }
  // Initial state of body class might be handled by CSS or here if needed.
  // document.body.classList.add('loading-active'); 
});
// --- END OF MOVED DOMContentLoaded ---

import './style.css';
import * as THREE from 'three';
import Stats from 'stats.js';
import { NoiseManager } from './world/NoiseManager';
import { MesherManager } from './world/MesherManager';
import { ChunkManager } from './world/ChunkManager';
import { NetworkManager } from './net/NetworkManager';
import { createECSWorld, Transform } from './ecs/world';
import { CameraTarget } from './ecs/components/CameraTarget';
import {
  createCameraSystem,
  // type CameraSystemControls, // Not directly used in main.tsx
  // FPS_EYE_HEIGHT, // Not directly used in main.tsx
  DEFAULT_ZOOM,
} from './ecs/systems/CameraSystem';
import { CameraMode } from './ecs/types';
import { createInputLookSystem } from './ecs/systems/inputLookSystem';
import { createTransformSystem, addObject3DToEntity, object3DMap } from './ecs/systems/transformSystem';
import { createPlayerMovementSystem, type PlayerMovementSystemControls } from './ecs/systems/PlayerMovementSystem';
import { addEntity, addComponent, hasComponent, type System as BitecsSystem, type IWorld } from 'bitecs';
import { Object3DRef } from './ecs/systems/transformSystem';
import { getPickingRay, raycastVoxel, getCenterScreenRay } from './utils/raycastVoxel'; // getMouseNDC removed as not used
import { VoxelHighlighter } from './render/Highlight';

// --- Helper types and functions for star classes ---
interface StarClass {
  name: string;
  probability: number;
  sizeRange: [number, number];
  brightnessRange: [number, number]; // HSL Lightness
  hueRange: [number, number];       // HSL Hue (0-1)
  saturationRange: [number, number]; // HSL Saturation (0-1)
}

const starClasses: StarClass[] = [
  { name: 'small', probability: 0.4, sizeRange: [0.5, 1.2], brightnessRange: [0.4, 0.65], hueRange: [0.5, 0.7], saturationRange: [0.1, 0.4] }, // Cooler, dimmer (e.g., faint blue/white)
  { name: 'medium', probability: 0.3, sizeRange: [1.0, 2.0], brightnessRange: [0.6, 0.8], hueRange: [0.0, 1.0], saturationRange: [0.2, 0.6] }, // Wider color spectrum, average brightness
  { name: 'large', probability: 0.2, sizeRange: [1.8, 3.0], brightnessRange: [0.75, 0.9], hueRange: [0.05, 0.15], saturationRange: [0.7, 0.9] }, // Warmer, brighter (e.g. yellows/oranges)
  { name: 'super', probability: 0.1, sizeRange: [18.0, 25.0], brightnessRange: [0.9, 1.0], hueRange: [0.3, 0.85], saturationRange: [0.8, 1.0] }  // Very bright, aurora-like (greens, blues, violets)
];

function getRandomStarClass(): StarClass {
  const rand = Math.random();
  let cumulativeProbability = 0;
  for (const starClass of starClasses) {
    cumulativeProbability += starClass.probability;
    if (rand <= cumulativeProbability) {
      return starClass;
    }
  }
  return starClasses[starClasses.length - 1]; // Fallback
}

function randomInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}
// --- End of helper types and functions ---

// --- Helper function to create star field ---
function createStarField(numberOfStars = 230, starSphereRadius = 1500): THREE.Points {
  const positions: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = []; // For individual star sizes
  const starColor = new THREE.Color();
  const randomOffsetMagnitude = 300; // Current user value from context

  for (let i = 0; i < numberOfStars; i++) {
    const phi = Math.acos(-1 + (2 * i) / numberOfStars);
    const theta = Math.sqrt(numberOfStars * Math.PI) * phi;

    const x = starSphereRadius * Math.cos(theta) * Math.sin(phi);
    const y = starSphereRadius * Math.sin(theta) * Math.sin(phi);
    const z = starSphereRadius * Math.cos(phi);

    positions.push(
      x + (Math.random() - 0.5) * randomOffsetMagnitude,
      y + (Math.random() - 0.5) * randomOffsetMagnitude,
      z + (Math.random() - 0.5) * randomOffsetMagnitude
    );

    const currentClass = getRandomStarClass();
    const starSize = randomInRange(currentClass.sizeRange[0], currentClass.sizeRange[1]);
    const starBrightness = randomInRange(currentClass.brightnessRange[0], currentClass.brightnessRange[1]);
    const starHue = randomInRange(currentClass.hueRange[0], currentClass.hueRange[1]);
    const starSaturation = randomInRange(currentClass.saturationRange[0], currentClass.saturationRange[1]);

    starColor.setHSL(starHue, starSaturation, starBrightness);
    colors.push(starColor.r, starColor.g, starColor.b);
    sizes.push(starSize);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1)); // Add size attribute

  const material = new THREE.PointsMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true // Set to true for world-space sizes from 'size' attribute
  });
  return new THREE.Points(geometry, material);
}
// --- END Helper function to create star field ---

// --- ALL APPLICATION LOGIC NOW WRAPPED IN main() ---
async function main() {
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) {
    loadingOverlay.style.display = 'flex';
    document.body.classList.add('loading-active');
    console.log('[Main] Loading overlay explicitly set to flex display.');
  }

  const urlParams = new URLSearchParams(window.location.search);
  const debugMode = urlParams.has('debug');
  const PLAYER_HEIGHT = 1.8;
  const PLAYER_RADIUS = 0.4;
  const DEFAULT_PLACE_BLOCK_ID = 1;
  let lastBlockActionTime = 0;
  const BLOCK_ACTION_COOLDOWN = 250;
  let serverInitialized = false;
  let clientReadyForDisplay = false;

  let timeOfDay = 0.25;
  const DAY_NIGHT_CYCLE_SPEED = 0.00005;
  const STAR_ROTATION_SPEED = 0.005; // Radians per second for star field rotation
  function lerp(a: number, b: number, t: number): number { return a * (1 - t) + b * t; }
  function lerpColor(colorA: THREE.Color, colorB: THREE.Color, t: number): THREE.Color {
    const result = colorA.clone(); result.lerp(colorB, t); return result;
  }
  interface Keyframe<T> { time: number; value: T; }
  function getValueOverTime<T extends number | THREE.Color>(
    currentTime: number, keyframes: Keyframe<T>[], isColor: boolean ): T 
  {
    const currentCycleTime = currentTime % 1.0;
    let prevKeyframe = keyframes[keyframes.length - 1];
    let nextKeyframe = keyframes[0];
    for (let i = 0; i < keyframes.length; i++) {
      if (currentCycleTime >= keyframes[i].time) {
        prevKeyframe = keyframes[i];
        if (i + 1 < keyframes.length) { nextKeyframe = keyframes[i+1]; } 
        else { nextKeyframe = keyframes[0]; }
      } else {
        if (i === 0) { prevKeyframe = keyframes[keyframes.length - 1]; nextKeyframe = keyframes[0]; }
        break;
      }
    }
    let t: number;
    if (prevKeyframe.time <= nextKeyframe.time) {
      const segmentDuration = nextKeyframe.time - prevKeyframe.time;
      if (segmentDuration === 0) return prevKeyframe.value;
      t = (currentCycleTime - prevKeyframe.time) / segmentDuration;
    } else {
      const segmentDuration = (1.0 - prevKeyframe.time) + nextKeyframe.time;
      if (segmentDuration === 0) return prevKeyframe.value;
      t = (currentCycleTime - prevKeyframe.time + (currentCycleTime < prevKeyframe.time ? 1.0 : 0)) / segmentDuration;
    }
    t = Math.max(0, Math.min(1, t));
    if (isColor) { return lerpColor(prevKeyframe.value as THREE.Color, nextKeyframe.value as THREE.Color, t) as T; }
    else { return lerp(prevKeyframe.value as number, nextKeyframe.value as number, t) as T; }
  }
  const sunIntensityKeyframes: Keyframe<number>[] = [
    { time: 0.0,  value: 0.0 }, { time: 0.20, value: 0.0 }, { time: 0.25, value: 1.5 }, 
    { time: 0.30, value: 3.0 }, { time: 0.50, value: 5.0 }, { time: 0.70, value: 3.0 }, 
    { time: 0.75, value: 1.5 }, { time: 0.80, value: 0.0 }, { time: 1.0,  value: 0.0 }
  ];
  const sunColorKeyframes: Keyframe<THREE.Color>[] = [
    { time: 0.0,  value: new THREE.Color(0x000000) }, { time: 0.20, value: new THREE.Color(0x000000) }, 
    { time: 0.25, value: new THREE.Color(0xFF6600) }, { time: 0.30, value: new THREE.Color(0xFFB870) }, 
    { time: 0.50, value: new THREE.Color(0xFFFFFF) }, { time: 0.70, value: new THREE.Color(0xFFB870) }, 
    { time: 0.75, value: new THREE.Color(0xFF6600) }, { time: 0.80, value: new THREE.Color(0x000000) }, 
    { time: 1.0,  value: new THREE.Color(0x000000) }
  ];
  const ambientIntensityKeyframes: Keyframe<number>[] = [
    { time: 0.0,  value: 0.4 }, { time: 0.20, value: 0.4 }, { time: 0.25, value: 1.2 }, 
    { time: 0.30, value: 1.2 }, { time: 0.50, value: 2.0 }, { time: 0.70, value: 1.2 }, 
    { time: 0.75, value: 1.2 }, { time: 0.80, value: 0.4 }, { time: 1.0,  value: 0.4 }
  ];
  const ambientColorKeyframes: Keyframe<THREE.Color>[] = [
    { time: 0.0,  value: new THREE.Color(0x101020) }, { time: 0.20, value: new THREE.Color(0x101020) },
    { time: 0.25, value: new THREE.Color(0x404060) }, { time: 0.50, value: new THREE.Color(0xA0A0CC) },
    { time: 0.75, value: new THREE.Color(0x404060) }, { time: 0.80, value: new THREE.Color(0x101020) },
    { time: 1.0,  value: new THREE.Color(0x101020) }
  ];
  const skyColorKeyframes: Keyframe<THREE.Color>[] = [
    { time: 0.0,  value: new THREE.Color(0x050510) }, { time: 0.20, value: new THREE.Color(0x050510) },
    { time: 0.24, value: new THREE.Color(0x202040) }, { time: 0.25, value: new THREE.Color(0x70A1FF) },
    { time: 0.26, value: new THREE.Color(0x87CEEB) }, { time: 0.50, value: new THREE.Color(0x87CEFA) },
    { time: 0.74, value: new THREE.Color(0x87CEEB) }, { time: 0.75, value: new THREE.Color(0xFFB070) },
    { time: 0.76, value: new THREE.Color(0x202040) }, { time: 0.80, value: new THREE.Color(0x050510) },
    { time: 1.0,  value: new THREE.Color(0x050510) }
  ];

  const MOON_LIGHT_COLOR = new THREE.Color(0xADC8FF); // Pale blue for moonlight ON TERRAIN

  const moonLightIntensityKeyframes: Keyframe<number>[] = [
    { time: 0.0,  value: 0.35 }, // Midnight peak
    { time: 0.20, value: 0.05 }, // Fading before sunrise
    { time: 0.24, value: 0.0 },  // Off as sun becomes significant
    { time: 0.76, value: 0.0 },  // Still off as sun fades
    { time: 0.80, value: 0.05 }, // Fading in after sunset
    { time: 1.0,  value: 0.35 }  // Midnight peak (same as 0.0)
  ];

  const moonLightColorKeyframes: Keyframe<THREE.Color>[] = [
    { time: 0.0, value: MOON_LIGHT_COLOR },
    { time: 1.0, value: MOON_LIGHT_COLOR }
  ];

  const scene = new THREE.Scene();
  const world: IWorld = createECSWorld();
  const initialAspect = window.innerWidth / window.innerHeight;
  const inputLookSystemInstance: BitecsSystem = createInputLookSystem(world, document, debugMode);
  const transformSystem = createTransformSystem(world);
  const playerEntity = addEntity(world);
  addComponent(world, Transform, playerEntity);
  Transform.position.x[playerEntity] = 0; Transform.position.y[playerEntity] = 70.0;
  Transform.position.z[playerEntity] = 0; Transform.rotation.x[playerEntity] = 0;
  Transform.rotation.y[playerEntity] = 0; Transform.rotation.z[playerEntity] = 0;
  Transform.rotation.w[playerEntity] = 1; Transform.scale.x[playerEntity] = 1;
  Transform.scale.y[playerEntity] = 1; Transform.scale.z[playerEntity] = 1;
  addComponent(world, CameraTarget, playerEntity);
  CameraTarget.mode[playerEntity] = CameraMode.FPS; CameraTarget.zoom[playerEntity] = DEFAULT_ZOOM;
  CameraTarget.pitch[playerEntity] = 0; CameraTarget.yaw[playerEntity] = 0;
  const playerGeometry = new THREE.CylinderGeometry(PLAYER_RADIUS, PLAYER_RADIUS, PLAYER_HEIGHT, 16);
  const playerMaterial = new THREE.MeshBasicMaterial({ color: 0x0077ff, wireframe: debugMode });
  const playerModelMesh = new THREE.Mesh(playerGeometry, playerMaterial);
  playerModelMesh.position.y = PLAYER_HEIGHT / 2;
  scene.add(playerModelMesh);
  const noiseManager = new NoiseManager(12345);
  const mesherManager = new MesherManager();
  const chunkManager = new ChunkManager(noiseManager, mesherManager, scene, null, 10, 450);
  const initialPlayerX = Transform.position.x[playerEntity];
  const initialPlayerZ = Transform.position.z[playerEntity];

  // Add a label for the render distance slider
  const renderDistanceLabel = document.createElement('span');
  renderDistanceLabel.id = 'renderDistanceVal';
  renderDistanceLabel.textContent = chunkManager.getRenderDistance().toString();

  // Add a slider for render distance
  const renderDistanceSlider = document.createElement('input');
  renderDistanceSlider.type = 'range';
  renderDistanceSlider.id = 'renderDistanceSlider';
  renderDistanceSlider.min = '1';
  renderDistanceSlider.max = '35';
  renderDistanceSlider.step = '1';
  renderDistanceSlider.value = chunkManager.getRenderDistance().toString(); // Set initial value from ChunkManager

  renderDistanceSlider.addEventListener('input', (event) => {
    const newDistance = parseInt((event.target as HTMLInputElement).value, 10);
    if (chunkManager) {
      chunkManager.setRenderDistance(newDistance);
    }
    if (renderDistanceLabel) {
      renderDistanceLabel.textContent = newDistance.toString();
    }
  });

  const debugMenu = document.getElementById('debugMenu');
  if (debugMenu) {
    const sliderContainer = document.createElement('div');
    sliderContainer.style.display = 'flex';
    sliderContainer.style.alignItems = 'center';
    sliderContainer.style.marginBottom = '5px';

    const sliderLabelText = document.createElement('span');
    sliderLabelText.textContent = 'Render Dist: ';
    sliderLabelText.style.marginRight = '5px';

    sliderContainer.appendChild(sliderLabelText);
    sliderContainer.appendChild(renderDistanceSlider);
    sliderContainer.appendChild(renderDistanceLabel);
    debugMenu.appendChild(sliderContainer);
  } else {
    console.warn("[Main] Debug menu div not found, can't add render distance slider.");
  }

  chunkManager.update(initialPlayerX, initialPlayerZ, scene, true)
    .then(() => console.log('[Main] Initial ChunkManager update promise resolved.'))
    .catch(error => console.error('[Main] Initial ChunkManager update promise rejected:', error));
  const cameraSystemManager = createCameraSystem(world, scene, initialAspect, window, playerModelMesh, chunkManager);
  const gameCamera = cameraSystemManager.camera;
  gameCamera.far = 5000; // Explicitly set far clipping plane
  gameCamera.updateProjectionMatrix(); // Apply change
  if (gameCamera.position.lengthSq() < 0.01) {
    gameCamera.position.set(0, 80, 20); gameCamera.lookAt(0, 0, 0);
  }
  if (!hasComponent(world, Object3DRef, playerEntity)) { addComponent(world, Object3DRef, playerEntity); }
  Object3DRef.value[playerEntity] = playerEntity;
  object3DMap.set(playerEntity, playerModelMesh);
  const movementSystemControls: PlayerMovementSystemControls = createPlayerMovementSystem(world, playerEntity, document, chunkManager);
  const playerMovementSystem = movementSystemControls.system;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('tabindex', '-1');
  document.body.appendChild(renderer.domElement);
  const ambientLight = new THREE.AmbientLight();
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight();
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048; directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5; directionalLight.shadow.camera.far = 500;
  directionalLight.shadow.camera.left = -200; directionalLight.shadow.camera.right = 200;
  directionalLight.shadow.camera.top = 200; directionalLight.shadow.camera.bottom = -200;
  directionalLight.shadow.camera.updateProjectionMatrix();
  directionalLight.shadow.bias = -0.001;
  scene.add(directionalLight);

  const moonLight = new THREE.DirectionalLight(); // Create moon light
  // moonLight.castShadow = false; // Default, but explicit for clarity
  scene.add(moonLight);

  const shadowCameraTarget = new THREE.Object3D();
  directionalLight.target = shadowCameraTarget;
  scene.add(shadowCameraTarget);
  const sunRadius = 20;
  const sunGeometry = new THREE.SphereGeometry(sunRadius, 32, 32);
  const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xFFDD88, fog: false });
  const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
  scene.add(sunMesh);

  // Load star texture
  const textureLoader = new THREE.TextureLoader();
  let starField: THREE.Points | null = null; // Declare starField here to be accessible

  // Load the star particle texture - REMOVED
  // let starParticleTexture: THREE.Texture | null = null;
  // textureLoader.load(
  //   '/soft_particle.png',
  //   (texture) => {
  //     starParticleTexture = texture;
  //     starParticleTexture.colorSpace = THREE.SRGBColorSpace; 
  //     console.log('[Main] Star particle texture loaded successfully.');
  //     recreateStarFieldIfNeeded(); // Recreate or update material if stars already exist
  //   },
  //   undefined,
  //   (err) => {
  //     console.error('[Main] An error occurred loading the star particle texture:', err);
  //     // If texture fails, starfield will be created with default point appearance
  //     recreateStarFieldIfNeeded(); 
  //   }
  // );

  // function recreateStarFieldIfNeeded() {
  //   if (starField) {
  //     scene.remove(starField);
  //     starField.geometry.dispose();
  //     (starField.material as THREE.Material).dispose();
  //   }
  //   starField = createStarField(starParticleTexture); // Pass the potentially loaded texture
  //   scene.add(starField);
  // }
  // Initial creation - will use null texture if not loaded yet, or default points if it fails.
  // recreateStarFieldIfNeeded(); 
  // MODIFIED: Directly create starfield without waiting for the texture.
  starField = createStarField();
  scene.add(starField);

  // Create Moon Mesh
  const moonRadius = 15;
  const moonGeometry = new THREE.SphereGeometry(moonRadius, 32, 32);
  const moonMaterial = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, fog: false }); // White MOON SPHERE
  const moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
  moonMesh.visible = false; // Initially hidden
  scene.add(moonMesh);

  const voxelHighlighter = new VoxelHighlighter(scene);
  let showCollisionBoxes = false;
  let showBlockHighlighter = true;
  let showCrosshair = true;
  const adminMenu = document.createElement('div');
  adminMenu.style.cssText = 'position:absolute; top:10px; left:10px; background-color:rgba(0,0,0,0.7); color:white; padding:10px; border-radius:5px; font-family:Arial,sans-serif; display:none; z-index:1000;';
  const menuContent = document.createElement('div');
  menuContent.innerHTML = `
    <h3 style="margin:0 0 10px 0">Admin Menu</h3>
    <div><label><input type="checkbox" id="flyingToggle" checked> Flying</label></div>
    <div><label><input type="checkbox" id="collisionToggle"> Collisions</label></div>
    <div><label><input type="checkbox" id="highlighterToggle" checked> Highlighter</label></div>
    <div><label><input type="checkbox" id="crosshairToggle" checked> Crosshair</label></div>
    <div><label><input type="checkbox" id="freezeTimeToggle"> Freeze Time</label></div>
    <div>
        <label for="timeOfDaySlider">Time of Day: <span id="timeOfDayValue">${timeOfDay.toFixed(2)}</span></label>
        <input type="range" id="timeOfDaySlider" min="0" max="1" step="0.01" value="${timeOfDay}" style="width: 100%;">
    </div>
  `;

  // Create container for the render distance slider elements
  const renderDistanceContainer = document.createElement('div');
  const renderDistanceSliderLabelText = document.createElement('label');
  renderDistanceSliderLabelText.htmlFor = 'renderDistanceSlider';
  renderDistanceSliderLabelText.textContent = 'Render Dist: ';
  
  const renderDistanceValueSpan = document.createElement('span');
  renderDistanceValueSpan.id = 'renderDistanceVal';
  renderDistanceValueSpan.textContent = chunkManager.getRenderDistance().toString();

  renderDistanceSliderLabelText.appendChild(renderDistanceValueSpan);

  const renderDistanceSliderElement = document.createElement('input');
  renderDistanceSliderElement.type = 'range';
  renderDistanceSliderElement.id = 'renderDistanceSlider';
  renderDistanceSliderElement.min = '1';
  renderDistanceSliderElement.max = '35';
  renderDistanceSliderElement.step = '1';
  renderDistanceSliderElement.value = chunkManager.getRenderDistance().toString();
  renderDistanceSliderElement.style.width = '100%';

  renderDistanceSliderElement.addEventListener('input', (event) => {
    const newDistance = parseInt((event.target as HTMLInputElement).value, 10);
    chunkManager.setRenderDistance(newDistance);
    renderDistanceValueSpan.textContent = newDistance.toString();
  });

  renderDistanceContainer.appendChild(renderDistanceSliderLabelText);
  renderDistanceContainer.appendChild(renderDistanceSliderElement);
  menuContent.appendChild(renderDistanceContainer); // Append to admin menu's content

  adminMenu.appendChild(menuContent);
  document.body.appendChild(adminMenu);
  const crosshairElement = document.createElement('div');
  crosshairElement.style.cssText = 'position:fixed; left:50%; top:50%; width:6px; height:6px; background-color:red; border-radius:50%; transform:translate(-50%,-50%); z-index:1001; pointer-events:none;';
  crosshairElement.style.display = showCrosshair ? 'block' : 'none';
  document.body.appendChild(crosshairElement);
  const flyingToggle = document.getElementById('flyingToggle') as HTMLInputElement;
  const collisionToggle = document.getElementById('collisionToggle') as HTMLInputElement;
  const highlighterToggle = document.getElementById('highlighterToggle') as HTMLInputElement;
  const crosshairToggle = document.getElementById('crosshairToggle') as HTMLInputElement;
  const freezeTimeToggle = document.getElementById('freezeTimeToggle') as HTMLInputElement;
  const timeOfDaySlider = document.getElementById('timeOfDaySlider') as HTMLInputElement;
  const timeOfDayValueSpan = document.getElementById('timeOfDayValue') as HTMLSpanElement;
  let isTimeFrozen = false;
  if (flyingToggle) flyingToggle.checked = movementSystemControls.isFlying();
  if (collisionToggle) collisionToggle.checked = showCollisionBoxes;
  if (highlighterToggle) highlighterToggle.checked = showBlockHighlighter;
  if (crosshairToggle) crosshairToggle.checked = showCrosshair;
  if (freezeTimeToggle) freezeTimeToggle.checked = isTimeFrozen;
  if (timeOfDaySlider) timeOfDaySlider.value = timeOfDay.toFixed(2);
  if (timeOfDayValueSpan) timeOfDayValueSpan.textContent = timeOfDay.toFixed(2);
  flyingToggle.addEventListener('change', () => { movementSystemControls.toggleFlying(); flyingToggle.checked = movementSystemControls.isFlying(); });
  collisionToggle.addEventListener('change', (e) => { showCollisionBoxes = (e.target as HTMLInputElement).checked; });
  highlighterToggle.addEventListener('change', (e) => { showBlockHighlighter = (e.target as HTMLInputElement).checked; if (!showBlockHighlighter && voxelHighlighter) voxelHighlighter.update(null); });
  crosshairToggle.addEventListener('change', (e) => { showCrosshair = (e.target as HTMLInputElement).checked; if (crosshairElement) crosshairElement.style.display = showCrosshair ? 'block' : 'none'; });
  freezeTimeToggle.addEventListener('change', (e) => { isTimeFrozen = (e.target as HTMLInputElement).checked; });
  timeOfDaySlider.addEventListener('input', (e) => {
    const newTime = parseFloat((e.target as HTMLInputElement).value);
    timeOfDay = newTime;
    if (timeOfDayValueSpan) timeOfDayValueSpan.textContent = newTime.toFixed(2);
  });
  const mainKeyDownHandler = (event: KeyboardEvent) => {
    switch (event.code) {
      case 'KeyP': event.preventDefault(); adminMenu.style.display = adminMenu.style.display === 'none' ? 'block' : 'none'; break;
      case 'KeyC':
        event.preventDefault();
        CameraTarget.mode[playerEntity] = CameraTarget.mode[playerEntity] === CameraMode.FPS ? CameraMode.TPS : CameraMode.FPS;
        if (CameraTarget.mode[playerEntity] === CameraMode.TPS && CameraTarget.zoom[playerEntity] === 0) CameraTarget.zoom[playerEntity] = DEFAULT_ZOOM;
        CameraTarget.pitch[playerEntity] = 0;
        break;
    }
  };
  document.addEventListener('keydown', mainKeyDownHandler);
  renderer.domElement.addEventListener('click', () => {
    if (!document.pointerLockElement) renderer.domElement.requestPointerLock();
  });
  let isPointerLockedToCanvas = false;
  const onPointerLockChange = () => { isPointerLockedToCanvas = (document.pointerLockElement === renderer.domElement); };
  const onPointerLockError = () => { isPointerLockedToCanvas = false; };
  document.addEventListener('pointerlockchange', onPointerLockChange, false);
  document.addEventListener('pointerlockerror', onPointerLockError, false);
  let stats: Stats | null = null;
  if (debugMode) { stats = new Stats(); stats.showPanel(0); document.body.appendChild(stats.dom); }
  const onServerInitCallback = () => { serverInitialized = true; };
  const networkManager = new NetworkManager(`ws://${window.location.hostname}:3000`, world, playerEntity, movementSystemControls, chunkManager, scene, onServerInitCallback);
  networkManager.connect();
  const MAX_RAYCAST_DISTANCE = 100;
  function updateCenterScreenVoxelHighlight() {
    if (!gameCamera || !chunkManager || !voxelHighlighter) return;
    if (!showBlockHighlighter) { voxelHighlighter.update(null); return; }
    const pickRay = getCenterScreenRay(gameCamera);
    const result = raycastVoxel(pickRay.origin, pickRay.direction, chunkManager, MAX_RAYCAST_DISTANCE);
    voxelHighlighter.update(result ? result.position : null);
  }
  function handleBlockInteraction(event: MouseEvent) {
    if (!isPointerLockedToCanvas) return;
    const now = Date.now();
    if (now - lastBlockActionTime < BLOCK_ACTION_COOLDOWN && !movementSystemControls.isFlying()) {
      if (showCrosshair && crosshairElement) crosshairElement.style.backgroundColor = 'grey';
      return;
    }
    lastBlockActionTime = now;
    if (crosshairElement) crosshairElement.style.backgroundColor = 'red';
    const centerRay = getCenterScreenRay(gameCamera);
    const hit = raycastVoxel(centerRay.origin, centerRay.direction, chunkManager, 10);
    if (hit && hit.voxel && hit.normal) {
      if (event.button === 0) { networkManager.sendMineCommand(hit.voxel.x, hit.voxel.y, hit.voxel.z); }
      else if (event.button === 2) {
        const placePosition = new THREE.Vector3().copy(hit.voxel).add(hit.normal);
        networkManager.sendPlaceCommand(placePosition.x, placePosition.y, placePosition.z, DEFAULT_PLACE_BLOCK_ID);
      }
    }
  }
  document.addEventListener('mousedown', handleBlockInteraction);
  
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    stats?.begin();
    const delta = clock.getDelta();

    if (!isTimeFrozen) {
      timeOfDay = (timeOfDay + delta * DAY_NIGHT_CYCLE_SPEED) % 1.0;
      if (timeOfDaySlider) timeOfDaySlider.value = timeOfDay.toFixed(2);
      if (timeOfDayValueSpan) timeOfDayValueSpan.textContent = timeOfDay.toFixed(2);
    }

    const sunAngle = (timeOfDay - 0.25) * Math.PI * 2;
    const sunDistance = 150;
    directionalLight.position.x = Math.cos(sunAngle) * sunDistance;
    directionalLight.position.y = Math.sin(sunAngle) * sunDistance * 0.75 + 20;
    directionalLight.position.z = Math.sin(sunAngle - Math.PI / 2) * sunDistance * 0.5;
    directionalLight.intensity = getValueOverTime(timeOfDay, sunIntensityKeyframes, false);
    directionalLight.color = getValueOverTime(timeOfDay, sunColorKeyframes, true);
    ambientLight.intensity = getValueOverTime(timeOfDay, ambientIntensityKeyframes, false);
    ambientLight.color = getValueOverTime(timeOfDay, ambientColorKeyframes, true);
    scene.background = getValueOverTime(timeOfDay, skyColorKeyframes, true);

    const sunMeshVisibleIntensity = getValueOverTime(timeOfDay, sunIntensityKeyframes, false);
    if (sunMesh && directionalLight) {
      const lightPositionNormalized = new THREE.Vector3().copy(directionalLight.position).normalize();
      const distanceToSunMesh = 450;
      sunMesh.position.copy(gameCamera.position).add(lightPositionNormalized.multiplyScalar(distanceToSunMesh));
      if (sunMeshVisibleIntensity > 0.05) {
        sunMesh.visible = true;
        (sunMesh.material as THREE.MeshBasicMaterial).color.copy(directionalLight.color);
      } else {
        sunMesh.visible = false;
      }
    }
    
    if (starField) {
      starField.position.copy(gameCamera.position);
      starField.rotation.y += STAR_ROTATION_SPEED * delta; // Planet spin effect
      if (sunMeshVisibleIntensity < 0.1) { 
        starField.visible = true;
      } else {
        starField.visible = false;
      }
    }

    // Moon Logic
    if (moonMesh && gameCamera) {
      const moonAngle = (timeOfDay - 0.75) * Math.PI * 2; // Offset from sun, rises as sun sets
      const moonDistance = 100; // Conceptual distance for orbit calculation
      const moonPathRadius = 400; // Visual distance from camera for moon mesh

      // Calculate moon's world position (simplified orbit for visual mesh)
      const moonOrbitX = Math.cos(moonAngle) * moonDistance;
      const moonOrbitY = Math.sin(moonAngle) * moonDistance * 0.6 + 10; // Lower arc than sun
      const moonOrbitZ = Math.sin(moonAngle - Math.PI / 2) * moonDistance * 0.5;
      const moonWorldPosition = new THREE.Vector3(moonOrbitX, moonOrbitY, moonOrbitZ);
      const moonDirectionNormalized = moonWorldPosition.clone().normalize(); // Direction from origin
      
      // Position visual moon mesh relative to camera
      moonMesh.position.copy(gameCamera.position).add(moonDirectionNormalized.clone().multiplyScalar(moonPathRadius));

      // Update Moon Light properties
      moonLight.position.copy(moonDirectionNormalized.clone().multiplyScalar(150)); // Place light source far away
      moonLight.intensity = getValueOverTime(timeOfDay, moonLightIntensityKeyframes, false);
      moonLight.color = getValueOverTime(timeOfDay, moonLightColorKeyframes, true);

      // Visibility for visual moon mesh
      const isNightTime = sunMeshVisibleIntensity < 0.15;
      const isMoonUp = moonOrbitY > -moonRadius; // Simple check if moon is above horizon line

      if (isNightTime && isMoonUp) {
        moonMesh.visible = true;
      } else {
        moonMesh.visible = false;
      }
    }

    if (directionalLight && shadowCameraTarget && Transform.position) {
      const playerWorldX = Transform.position.x[playerEntity];
      const playerWorldZ = Transform.position.z[playerEntity];
      shadowCameraTarget.position.set(playerWorldX, 0, playerWorldZ);
    }

    if (loadingOverlay && !clientReadyForDisplay && serverInitialized) {
      const progress = chunkManager.getLoadProgress();
      if (progress.percentage >= 0.60) {
        clientReadyForDisplay = true;
        loadingOverlay.classList.add('hidden');
        loadingOverlay.addEventListener('animationend', () => {
          if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
            document.body.classList.remove('loading-active');
          }
        }, { once: true });
      }
    }

    inputLookSystemInstance(world);
    playerMovementSystem(world, delta);
    cameraSystemManager.system(world);
    transformSystem(world);
    const pX = Transform.position.x[playerEntity];
    const pZ = Transform.position.z[playerEntity];
    chunkManager.update(pX, pZ, scene, true);
    updateCenterScreenVoxelHighlight();
    if (showCollisionBoxes) {
      // updateCollisionVisualization logic would be here if not shortened
    }
    renderer.render(scene, gameCamera);
    stats?.end();
  }
  animate();
  window.addEventListener('unload', () => {
    networkManager.disconnect();
    chunkManager.dispose();
    noiseManager.dispose();
    mesherManager.dispose();
    document.removeEventListener('keydown', mainKeyDownHandler);
    if (adminMenu.parentNode) document.body.removeChild(adminMenu);
    if (crosshairElement.parentNode) document.body.removeChild(crosshairElement);
    cameraSystemManager.cleanup();
    if ((inputLookSystemInstance as any).cleanup) (inputLookSystemInstance as any).cleanup();
    movementSystemControls.cleanup();
    document.removeEventListener('mousedown', handleBlockInteraction);
    document.removeEventListener('pointerlockchange', onPointerLockChange, false);
    document.removeEventListener('pointerlockerror', onPointerLockError, false);
    if (stats && stats.dom.parentNode) document.body.removeChild(stats.dom);
  });
}
main().catch(err => {
  console.error('[Main] Fatal boot error:', err);
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) {
    loadingOverlay.innerHTML = `<div>Error during startup. Check console. <pre>${err}</pre></div>`;
    loadingOverlay.style.display = 'flex';
    loadingOverlay.style.color = 'red';
    loadingOverlay.style.backgroundColor = 'black';
  }
}); 