import './style.css';
import * as THREE from 'three';
import Stats from 'stats.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { NoiseManager } from './world/NoiseManager';
import { MesherManager } from './world/MesherManager';
import { ChunkManager } from './world/ChunkManager';
import { NetworkManager } from './net/NetworkManager';

// Initialize scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue background

// Initialize camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 100, 0); // Start well above terrain (base height 20 + sea level 64 + extra buffer)
camera.lookAt(0, 0, 0);

// Initialize renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Initialize pointer lock controls
const controls = new PointerLockControls(camera, document.body);
scene.add(controls.getObject());

// Add lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(100, 100, 100);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 500;
directionalLight.shadow.camera.left = -100;
directionalLight.shadow.camera.right = 100;
directionalLight.shadow.camera.top = 100;
directionalLight.shadow.camera.bottom = -100;
scene.add(directionalLight);

// Create debug visualization for collision zones
const collisionMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.5, // Increased opacity for better visibility
  side: THREE.DoubleSide,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1
});

// Track last chunk position for collision visualization
let lastCollisionChunkX = -1;
let lastCollisionChunkZ = -1;

// Debug mode variables
let isFlying = true; // Enable flying mode by default
const flySpeed = 15.0;
let showCollisionBoxes = true; // Show collision boxes by default

// Create admin menu
const adminMenu = document.createElement('div');
adminMenu.style.position = 'absolute';
adminMenu.style.top = '10px';
adminMenu.style.left = '10px';
adminMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
adminMenu.style.color = 'white';
adminMenu.style.padding = '10px';
adminMenu.style.borderRadius = '5px';
adminMenu.style.fontFamily = 'Arial, sans-serif';
adminMenu.style.display = 'none';
adminMenu.style.zIndex = '1000';

// Create menu content
const menuContent = document.createElement('div');
menuContent.innerHTML = `
  <h3 style="margin: 0 0 10px 0">Admin Menu</h3>
  <div style="margin-bottom: 5px">
    <label style="display: flex; align-items: center; gap: 5px">
      <input type="checkbox" id="flyingToggle" checked>
      Flying Mode
    </label>
  </div>
  <div style="margin-bottom: 5px">
    <label style="display: flex; align-items: center; gap: 5px">
      <input type="checkbox" id="collisionToggle" checked>
      Show Collision Boxes
    </label>
  </div>
`;
adminMenu.appendChild(menuContent);
document.body.appendChild(adminMenu);

// Add event listeners for toggles
const flyingToggle = document.getElementById('flyingToggle') as HTMLInputElement;
const collisionToggle = document.getElementById('collisionToggle') as HTMLInputElement;

flyingToggle.addEventListener('change', (e) => {
  isFlying = (e.target as HTMLInputElement).checked;
  console.debug(`Flying mode ${isFlying ? 'enabled' : 'disabled'}`);
  // Reset velocity when toggling modes
  velocity.set(0, 0, 0);
});

collisionToggle.addEventListener('change', (e) => {
  showCollisionBoxes = (e.target as HTMLInputElement).checked;
  console.debug(`Collision boxes ${showCollisionBoxes ? 'enabled' : 'disabled'}`);
  // Remove existing collision visualization if turning off
  if (!showCollisionBoxes) {
    scene.children.forEach(child => {
      if (child.userData.isCollisionVisual) {
        scene.remove(child);
      }
    });
  } else {
    // Force update collision visualization
    lastCollisionChunkX = -1;
    lastCollisionChunkZ = -1;
  }
});

// Function to check if a point is in view frustum
function isInViewFrustum(camera: THREE.PerspectiveCamera, point: THREE.Vector3): boolean {
  const frustum = new THREE.Frustum();
  const projScreenMatrix = new THREE.Matrix4();
  projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);
  return frustum.containsPoint(point);
}

// Function to update collision visualization
function updateCollisionVisualization(playerPos: THREE.Vector3, camera: THREE.PerspectiveCamera) {
  // Skip if collision boxes are disabled
  if (!showCollisionBoxes) return;

  // Check if we've moved to a new chunk
  const currentChunkX = Math.floor(playerPos.x / 32);
  const currentChunkZ = Math.floor(playerPos.z / 32);
  
  if (currentChunkX === lastCollisionChunkX && currentChunkZ === lastCollisionChunkZ) {
    return; // Don't update if we're in the same chunk
  }
  
  console.debug(`Updating collision visualization for chunk (${currentChunkX}, ${currentChunkZ})`);
  
  // Update last chunk position
  lastCollisionChunkX = currentChunkX;
  lastCollisionChunkZ = currentChunkZ;

  // Remove old collision visualization
  scene.children.forEach(child => {
    if (child.userData.isCollisionVisual) {
      scene.remove(child);
    }
  });

  // Create collision visualization for surrounding chunks
  const chunkX = Math.floor(playerPos.x / 32);
  const chunkZ = Math.floor(playerPos.z / 32);
  
  // Reduce radius to improve performance
  const chunkRadius = 2; // Only show 2 chunks in each direction
  
  let totalBlocks = 0;
  let visibleBlocks = 0;
  
  // Create a single geometry for all collision faces
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;
  
  // Increased offset to make collision boxes more visible above terrain
  const offset = 0.05; // Increased from 0.001 to 0.05
  
  // Helper function to get chunk data
  function getChunkData(chunkX: number, chunkZ: number) {
    const key = `${chunkX},${chunkZ}`;
    return chunkManager.getChunkData(key);
  }
  
  // Helper function to check if a block exists, handling chunk boundaries
  function hasBlock(worldX: number, worldY: number, worldZ: number): boolean {
    if (worldY < 0 || worldY >= 128) return false;
    
    const chunkX = Math.floor(worldX / 32);
    const chunkZ = Math.floor(worldZ / 32);
    const localX = ((worldX % 32) + 32) % 32; // Handle negative coordinates
    const localZ = ((worldZ % 32) + 32) % 32;
    
    const chunkData = getChunkData(chunkX, chunkZ);
    if (!chunkData) return false;
    
    return chunkData.hasBlock(localX, worldY, localZ);
  }
  
  // Check chunks within radius
  for (let x = -chunkRadius; x <= chunkRadius; x++) {
    for (let z = -chunkRadius; z <= chunkRadius; z++) {
      const currentChunkX = chunkX + x;
      const currentChunkZ = chunkZ + z;
      
      // Get chunk data
      const chunkData = getChunkData(currentChunkX, currentChunkZ);
      if (!chunkData) {
        console.debug(`No chunk data found for ${currentChunkX},${currentChunkZ}`);
        continue;
      }

      // Create collision visualization for each block in the chunk
      for (let blockX = 0; blockX < 32; blockX++) {
        for (let blockZ = 0; blockZ < 32; blockZ++) {
          for (let blockY = 0; blockY < 128; blockY++) {
            // Check if block exists
            if (!chunkData.hasBlock(blockX, blockY, blockZ)) continue;
            
            totalBlocks++;

            const worldX = currentChunkX * 32 + blockX;
            const worldZ = currentChunkZ * 32 + blockZ;
            
            // Calculate distance to block center
            const blockCenterX = worldX + 0.5;
            const blockCenterZ = worldZ + 0.5;
            const blockDx = blockCenterX - playerPos.x;
            const blockDz = blockCenterZ - playerPos.z;
            const blockDistance = Math.sqrt(blockDx * blockDx + blockDz * blockDz);
            
            // Skip blocks beyond 32 units (1 chunk)
            if (blockDistance > 32) continue;

            // Check which faces are exposed to air, using world coordinates
            const hasTop = !hasBlock(worldX, blockY + 1, worldZ);
            const hasBottom = !hasBlock(worldX, blockY - 1, worldZ);
            const hasFront = !hasBlock(worldX, blockY, worldZ + 1);
            const hasBack = !hasBlock(worldX, blockY, worldZ - 1);
            const hasRight = !hasBlock(worldX + 1, blockY, worldZ);
            const hasLeft = !hasBlock(worldX - 1, blockY, worldZ);

            // Skip if no faces are exposed
            if (!hasTop && !hasBottom && !hasFront && !hasBack && !hasRight && !hasLeft) continue;

            visibleBlocks++;
            
            // Add vertices for exposed faces
            const x = blockCenterX;
            const y = blockY + 0.5;
            const z = blockCenterZ;
            
            // Top face
            if (hasTop) {
              positions.push(
                x - 0.5, y + 0.5 + offset, z - 0.5,  // bottom left
                x + 0.5, y + 0.5 + offset, z - 0.5,  // bottom right
                x + 0.5, y + 0.5 + offset, z + 0.5,  // top right
                x - 0.5, y + 0.5 + offset, z + 0.5   // top left
              );
              indices.push(
                vertexCount, vertexCount + 1, vertexCount + 2,
                vertexCount, vertexCount + 2, vertexCount + 3
              );
              vertexCount += 4;
            }
            
            // Bottom face
            if (hasBottom) {
              positions.push(
                x - 0.5, y - 0.5 - offset, z - 0.5,  // bottom left
                x + 0.5, y - 0.5 - offset, z - 0.5,  // bottom right
                x + 0.5, y - 0.5 - offset, z + 0.5,  // top right
                x - 0.5, y - 0.5 - offset, z + 0.5   // top left
              );
              indices.push(
                vertexCount, vertexCount + 1, vertexCount + 2,
                vertexCount, vertexCount + 2, vertexCount + 3
              );
              vertexCount += 4;
            }
            
            // Front face
            if (hasFront) {
              positions.push(
                x - 0.5, y - 0.5, z + 0.5 + offset,  // bottom left
                x + 0.5, y - 0.5, z + 0.5 + offset,  // bottom right
                x + 0.5, y + 0.5, z + 0.5 + offset,  // top right
                x - 0.5, y + 0.5, z + 0.5 + offset   // top left
              );
              indices.push(
                vertexCount, vertexCount + 1, vertexCount + 2,
                vertexCount, vertexCount + 2, vertexCount + 3
              );
              vertexCount += 4;
            }
            
            // Back face
            if (hasBack) {
              positions.push(
                x - 0.5, y - 0.5, z - 0.5 - offset,  // bottom left
                x + 0.5, y - 0.5, z - 0.5 - offset,  // bottom right
                x + 0.5, y + 0.5, z - 0.5 - offset,  // top right
                x - 0.5, y + 0.5, z - 0.5 - offset   // top left
              );
              indices.push(
                vertexCount, vertexCount + 1, vertexCount + 2,
                vertexCount, vertexCount + 2, vertexCount + 3
              );
              vertexCount += 4;
            }
            
            // Right face
            if (hasRight) {
              positions.push(
                x + 0.5 + offset, y - 0.5, z - 0.5,  // bottom left
                x + 0.5 + offset, y - 0.5, z + 0.5,  // bottom right
                x + 0.5 + offset, y + 0.5, z + 0.5,  // top right
                x + 0.5 + offset, y + 0.5, z - 0.5   // top left
              );
              indices.push(
                vertexCount, vertexCount + 1, vertexCount + 2,
                vertexCount, vertexCount + 2, vertexCount + 3
              );
              vertexCount += 4;
            }
            
            // Left face
            if (hasLeft) {
              positions.push(
                x - 0.5 - offset, y - 0.5, z - 0.5,  // bottom left
                x - 0.5 - offset, y - 0.5, z + 0.5,  // bottom right
                x - 0.5 - offset, y + 0.5, z + 0.5,  // top right
                x - 0.5 - offset, y + 0.5, z - 0.5   // top left
              );
              indices.push(
                vertexCount, vertexCount + 1, vertexCount + 2,
                vertexCount, vertexCount + 2, vertexCount + 3
              );
              vertexCount += 4;
            }
          }
        }
      }
    }
  }
  
  // Create a single mesh for all collision faces
  if (positions.length > 0) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    
    const mesh = new THREE.Mesh(geometry, collisionMaterial);
    mesh.userData.isCollisionVisual = true;
    mesh.renderOrder = 1; // Ensure collision boxes render after terrain
    scene.add(mesh);
  }
  
  console.debug(`Created collision visualization: ${visibleBlocks} visible blocks out of ${totalBlocks} total blocks`);
}

// Character movement variables
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let moveUp = false;
let moveDown = false;
let canJump = false;
const gravity = 50;
const playerHeight = 2;
const playerSpeed = 10.0;
const maxFallSpeed = 50;
const groundCheckDistance = 0.1;
const minGroundHeight = 64;
const jumpForce = 10;
const collisionCheckPoints = 4; // Number of points to check for collision

// Movement controls
const onKeyDown = (event: KeyboardEvent) => {
  switch (event.code) {
    case 'ArrowUp':
    case 'KeyW':
      moveForward = true;
      break;
    case 'ArrowLeft':
    case 'KeyA':
      moveLeft = true;
      break;
    case 'ArrowDown':
    case 'KeyS':
      moveBackward = true;
      break;
    case 'ArrowRight':
    case 'KeyD':
      moveRight = true;
      break;
    case 'Space':
      if (isFlying) {
        moveUp = true;
      } else if (canJump) {
        velocity.y = jumpForce;
        canJump = false;
      }
      break;
    case 'ShiftLeft':
      if (isFlying) {
        moveDown = true;
      }
      break;
    case 'KeyF':
      // Toggle flying mode
      isFlying = !isFlying;
      flyingToggle.checked = isFlying;
      console.debug(`Flying mode ${isFlying ? 'enabled' : 'disabled'}`);
      // Reset velocity when toggling modes
      velocity.set(0, 0, 0);
      break;
    case 'KeyP':
      // Toggle admin menu
      adminMenu.style.display = adminMenu.style.display === 'none' ? 'block' : 'none';
      break;
  }
};

const onKeyUp = (event: KeyboardEvent) => {
  switch (event.code) {
    case 'ArrowUp':
    case 'KeyW':
      moveForward = false;
      break;
    case 'ArrowLeft':
    case 'KeyA':
      moveLeft = false;
      break;
    case 'ArrowDown':
    case 'KeyS':
      moveBackward = false;
      break;
    case 'ArrowRight':
    case 'KeyD':
      moveRight = false;
      break;
    case 'Space':
      moveUp = false;
      break;
    case 'ShiftLeft':
      moveDown = false;
      break;
  }
};

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

// Track last camera position and direction
let lastCameraPosition = new THREE.Vector3();
let lastCameraDirection = new THREE.Vector3();
camera.getWorldDirection(lastCameraDirection);
lastCameraPosition.copy(camera.position);

// Click to start
renderer.domElement.addEventListener('click', () => {
  controls.lock();
});

// Initialize stats if in debug mode
const urlParams = new URLSearchParams(window.location.search);
const debugMode = urlParams.has('debug');
let stats: Stats | null = null;

if (debugMode) {
  stats = new Stats();
  stats.showPanel(0);
  document.body.appendChild(stats.dom);
}

// Initialize managers
const noiseManager = new NoiseManager(12345);
const mesherManager = new MesherManager();
const chunkManager = new ChunkManager(noiseManager, mesherManager, scene, 4, 100, 5);

// Initialize network manager
const networkManager = new NetworkManager('ws://localhost:8080', camera);
networkManager.connect();

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animation loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  stats?.begin();
  
  if (controls.isLocked) {
    const delta = clock.getDelta();
    const playerPos = controls.getObject().position;

    // Update collision visualization with camera
    updateCollisionVisualization(playerPos, camera);

    // Get ground height at current position
    const groundHeight = chunkManager.getHeightAtPosition(playerPos.x, playerPos.z);
    const effectiveGroundHeight = Math.max(groundHeight, minGroundHeight);
    const isGrounded = Math.abs(playerPos.y - (effectiveGroundHeight + playerHeight)) < groundCheckDistance;

    // Get camera direction for movement
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    // Force camera direction to be horizontal for ground movement
    const horizontalDirection = cameraDirection.clone();
    horizontalDirection.y = 0;
    horizontalDirection.normalize();

    // Calculate movement direction based on camera
    const moveDirection = new THREE.Vector3();
    
    if (moveForward) {
      moveDirection.add(horizontalDirection);
    }
    if (moveBackward) {
      moveDirection.sub(horizontalDirection);
    }
    if (moveLeft) {
      moveDirection.add(new THREE.Vector3(-horizontalDirection.z, 0, horizontalDirection.x));
    }
    if (moveRight) {
      moveDirection.add(new THREE.Vector3(horizontalDirection.z, 0, -horizontalDirection.x));
    }

    // Normalize movement direction
    if (moveDirection.length() > 0) {
      moveDirection.normalize();
    }

    // Apply movement
    if (isFlying) {
      // Flying mode movement
      const speed = flySpeed * delta;
      
      // Horizontal movement
      playerPos.x += moveDirection.x * speed;
      playerPos.z += moveDirection.z * speed;
      
      // Vertical movement
      if (moveUp) {
        playerPos.y += speed;
      }
      if (moveDown) {
        playerPos.y -= speed;
      }
      
      // Reset velocity in flying mode
      velocity.set(0, 0, 0);
    } else {
      // Ground movement
      const moveX = moveDirection.x * playerSpeed * delta;
      const moveZ = moveDirection.z * playerSpeed * delta;
      const targetX = playerPos.x + moveX;
      const targetZ = playerPos.z + moveZ;

      // Check if we can move to the target position
      const targetHeight = chunkManager.getHeightAtPosition(targetX, targetZ);
      const currentHeight = chunkManager.getHeightAtPosition(playerPos.x, playerPos.z);
      const heightDiff = targetHeight - currentHeight;
      
      // Only allow movement if we're grounded and the height difference is reasonable
      const canMove = isGrounded && Math.abs(heightDiff) <= 1;

      // Apply horizontal movement only if allowed
      if (canMove) {
        playerPos.x += moveX;
        playerPos.z += moveZ;
      }

      // Apply gravity
      velocity.y -= gravity * delta;
      velocity.y = Math.max(-maxFallSpeed, velocity.y);

      // Calculate new vertical position
      const newY = playerPos.y + velocity.y * delta;

      // Get ground height at new position
      const newGroundHeight = chunkManager.getHeightAtPosition(playerPos.x, playerPos.z);
      const newEffectiveGroundHeight = Math.max(newGroundHeight, minGroundHeight);
      const minY = newEffectiveGroundHeight + playerHeight;

      // Apply vertical movement with collision
      if (newY < minY) {
        playerPos.y = minY;
        velocity.y = 0;
        canJump = true;
      } else {
        playerPos.y = newY;
        canJump = false;
      }
    }

    // Update chunks if position changed
    chunkManager.update(camera.position.x, camera.position.z, scene, true);
    lastCameraPosition.copy(camera.position);
  }
  
  renderer.render(scene, camera);
  stats?.end();
}

// Start animation loop
animate();

// Cleanup on page unload
window.addEventListener('unload', () => {
  networkManager.disconnect();
  chunkManager.dispose();
  noiseManager.dispose();
  mesherManager.dispose();
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);
  document.body.removeChild(adminMenu);
}); 