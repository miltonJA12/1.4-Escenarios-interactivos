import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Sky } from 'three/addons/objects/Sky.js';
import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat';

await RAPIER.init({});

const container = document.getElementById('scene-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
container.appendChild(renderer.domElement);

// ==========================================
// 1. CIELO Y ATMÓSFERA DINÁMICA (SKY SHADER)
// ==========================================
const sky = new Sky();
sky.scale.setScalar(450000);
scene.add(sky);

const sun = new THREE.Vector3();
const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value = 10;
skyUniforms['rayleigh'].value = 3;
skyUniforms['mieCoefficient'].value = 0.005;
skyUniforms['mieDirectionalG'].value = 0.7;

const elevation = 15; // Ángulo del sol en grados
const azimuth = 180;
const phi = THREE.MathUtils.degToRad(90 - elevation);
const theta = THREE.MathUtils.degToRad(azimuth);
sun.setFromSphericalCoords(1, phi, theta);
skyUniforms['sunPosition'].value.copy(sun);

// Iluminación realista basada en el sol
scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x182030, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
dirLight.position.copy(sun).multiplyScalar(100);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
scene.add(dirLight);

const clock = new THREE.Clock();
const worldOctree = new Octree();
const playerCollider = new Capsule(new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(0, 1, 0), 0.35);
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
const keyStates = {};
let playerOnFloor = false;

// Rapier World
const gravity = { x: 0, y: -25.0, z: 0 };
const physicsWorld = new RAPIER.World(gravity);
let physicalObjects = [];
const lasers = [];
const particles = [];

// ==========================================
// 2. MATERIALES Y DENSIDADES DIVERSIFICADAS
// ==========================================
const MATERIALS = {
  plastic: { friction: 0.5, restitution: 0.4, density: 1.5, roughness: 0.3, metalness: 0.1 },
  wood:    { friction: 0.7, restitution: 0.2, density: 2.5, roughness: 0.7, metalness: 0.0 },
  metal:   { friction: 0.4, restitution: 0.1, density: 8.0, roughness: 0.2, metalness: 0.8 },
  glass:   { friction: 0.1, restitution: 0.7, density: 3.0, roughness: 0.1, metalness: 0.9 }
};

function createPhysicalShape(type, x, y, z, scale, colorHex, matType = 'plastic') {
  let geometry, colliderDesc;
  const matProps = MATERIALS[matType];
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: matProps.roughness,
    metalness: matProps.metalness
  });

  switch (type) {
    case 'box':
      geometry = new THREE.BoxGeometry(scale, scale, scale);
      colliderDesc = RAPIER.ColliderDesc.cuboid(scale / 2, scale / 2, scale / 2);
      break;
    case 'sphere':
      geometry = new THREE.SphereGeometry(scale * 0.55, 24, 24);
      colliderDesc = RAPIER.ColliderDesc.ball(scale * 0.55);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(scale * 0.4, scale * 0.4, scale * 1.1, 16);
      colliderDesc = RAPIER.ColliderDesc.cylinder(scale * 0.55, scale * 0.4);
      break;
    case 'cone':
      geometry = new THREE.ConeGeometry(scale * 0.5, scale * 1.1, 16);
      colliderDesc = RAPIER.ColliderDesc.cone(scale * 0.55, scale * 0.5);
      break;
    case 'icosahedron':
      geometry = new THREE.IcosahedronGeometry(scale * 0.5, 0);
      const pos = geometry.attributes.position.array;
      colliderDesc = RAPIER.ColliderDesc.convexHull(new Float32Array(pos));
      break;
  }

  colliderDesc.setFriction(matProps.friction)
    .setRestitution(matProps.restitution)
    .setDensity(matProps.density);

  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCcdEnabled(true);
  const body = physicsWorld.createRigidBody(rigidBodyDesc);
  physicsWorld.createCollider(colliderDesc, body);

  physicalObjects.push({ mesh, body, initialPos: { x, y, z }, type, scale, colorHex, matType });
  updateCounter();
}

function clearAndSpawnShapes() {
  // Eliminar físicas y meshes anteriores
  physicalObjects.forEach((item) => {
    scene.remove(item.mesh);
    physicsWorld.removeRigidBody(item.body);
  });
  physicalObjects = [];

  const palette = [0x38bdf8, 0xf43f5e, 0xfacc15, 0x4ade80, 0xa855f7, 0xf97316, 0xec4899, 0x06b6d4];
  const shapes = ['box', 'sphere', 'cylinder', 'cone', 'icosahedron'];
  const matTypes = ['plastic', 'wood', 'metal', 'glass'];

  const zones = [
    { minX: -4, maxX: 4, minZ: -10, maxZ: -4, baseY: 0.0 },
    { minX: -8, maxX: -4, minZ: -12, maxZ: -3, baseY: 0.0 },
    { minX: 4, maxX: 8, minZ: -12, maxZ: -3, baseY: 0.0 },
    { minX: -3, maxX: 3, minZ: -16, maxZ: -12, baseY: 2.3 },
    { minX: 6, maxX: 9, minZ: -10, maxZ: -6, baseY: 2.3 }
  ];

  // Generar Torres y figuras
  zones.forEach((zone) => {
    const stackHeight = 2 + Math.floor(Math.random() * 3);
    const x = zone.minX + Math.random() * (zone.maxX - zone.minX);
    const z = zone.minZ + Math.random() * (zone.maxZ - zone.minZ);
    let currentY = zone.baseY;

    for (let h = 0; h < stackHeight; h++) {
      const shape = shapes[Math.floor(Math.random() * shapes.length)];
      const mat = matTypes[Math.floor(Math.random() * matTypes.length)];
      const scale = 0.6 + Math.random() * 0.6;
      const color = palette[Math.floor(Math.random() * palette.length)];

      currentY += scale * 0.6;
      createPhysicalShape(shape, x, currentY, z, scale, color, mat);
      currentY += scale * 0.6;
    }
  });

  for (let i = 0; i < 15; i++) {
    const zone = zones[Math.floor(Math.random() * zones.length)];
    const x = zone.minX + Math.random() * (zone.maxX - zone.minX);
    const z = zone.minZ + Math.random() * (zone.maxZ - zone.minZ);
    const shape = shapes[i % shapes.length];
    const mat = matTypes[i % matTypes.length];
    const scale = 0.5 + Math.random() * 1.0;
    const color = palette[Math.floor(Math.random() * palette.length)];

    createPhysicalShape(shape, x, zone.baseY + scale + 0.1, z, scale, color, mat);
  }
}

function updateCounter() {
  const el = document.getElementById('object-counter');
  if (el) el.innerText = `Objetos: ${physicalObjects.length}`;
}

// Cargar Escenario GLTF
const loader = new GLTFLoader();
loader.load('./assets/models/collision-world.glb', (gltf) => {
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;

      const positions = child.geometry.attributes.position.array;
      const worldVertices = new Float32Array(positions.length);
      const vertex = new THREE.Vector3();

      for (let i = 0; i < positions.length; i += 3) {
        vertex.set(positions[i], positions[i + 1], positions[i + 2]);
        vertex.applyMatrix4(child.matrixWorld);
        worldVertices[i] = vertex.x;
        worldVertices[i + 1] = vertex.y;
        worldVertices[i + 2] = vertex.z;
      }

      const indices = child.geometry.index ? new Uint32Array(child.geometry.index.array) : new Uint32Array(positions.length / 3);
      if (!child.geometry.index) for (let i = 0; i < indices.length; i++) indices[i] = i;

      physicsWorld.createCollider(RAPIER.ColliderDesc.trimesh(worldVertices, indices).setFriction(0.9));
    }
  });

  scene.add(model);
  worldOctree.fromGraphNode(model);
  clearAndSpawnShapes();
});

// Controles y movimiento
function getForwardVector() {
  camera.getWorldDirection(playerDirection);
  playerDirection.y = 0;
  return playerDirection.normalize();
}

function getSideVector() {
  camera.getWorldDirection(playerDirection);
  playerDirection.y = 0;
  playerDirection.normalize().cross(camera.up);
  return playerDirection;
}

function controls(deltaTime) {
  const speed = playerOnFloor ? 18 : 7;
  if (keyStates.KeyW) playerVelocity.add(getForwardVector().multiplyScalar(speed * deltaTime));
  if (keyStates.KeyS) playerVelocity.add(getForwardVector().multiplyScalar(-speed * deltaTime));
  if (keyStates.KeyA) playerVelocity.add(getSideVector().multiplyScalar(-speed * deltaTime));
  if (keyStates.KeyD) playerVelocity.add(getSideVector().multiplyScalar(speed * deltaTime));
  if (playerOnFloor && keyStates.Space) playerVelocity.y = 9;
}

function playerCollisions() {
  const result = worldOctree.capsuleIntersect(playerCollider);
  playerOnFloor = false;
  if (result) {
    playerOnFloor = result.normal.y > 0;
    if (!playerOnFloor) playerVelocity.addScaledVector(result.normal, -result.normal.dot(playerVelocity));
    playerCollider.translate(result.normal.multiplyScalar(result.depth));
  }
}

function pushNearbyObjects() {
  if (new THREE.Vector3(playerVelocity.x, 0, playerVelocity.z).lengthSq() < 0.04) return;
  physicalObjects.forEach((item) => {
    const p = item.body.translation();
    const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
    if (d < 1.3) {
      const force = 1.0 / Math.max(d, 0.25);
      item.body.applyImpulse({ x: (p.x - camera.position.x) * force, y: 0.1, z: (p.z - camera.position.z) * force }, true);
    }
  });
}

function updatePlayer(deltaTime) {
  let damping = Math.exp(-4 * deltaTime) - 1;
  if (!playerOnFloor) {
    playerVelocity.y -= 25 * deltaTime;
    damping *= 0.1;
  }
  playerVelocity.addScaledVector(playerVelocity, damping);
  playerCollider.translate(playerVelocity.clone().multiplyScalar(deltaTime));
  playerCollisions();
  camera.position.copy(playerCollider.end);
  pushNearbyObjects();

  if (camera.position.y < -20) {
    playerCollider.start.set(0, 0.35, 0);
    playerCollider.end.set(0, 1, 0);
    playerVelocity.set(0, 0, 0);
    camera.position.copy(playerCollider.end);
  }
}

// ==========================================
// 3. MODOS DE DISPARO (NORMAL Y SUPER BOMBA)
// ==========================================

function shootLaser(isSuper = false) {
  if (document.pointerLockElement !== renderer.domElement) return;
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction).normalize();

  // Muzzle flash
  const color = isSuper ? 0xf43f5e : 0x38bdf8;
  const flash = new THREE.PointLight(color, isSuper ? 25 : 12, 8);
  flash.position.copy(camera.position).addScaledVector(direction, 0.5);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 50);

  const laserGroup = new THREE.Group();
  const radius = isSuper ? 0.12 : 0.035;
  const coreGeo = new THREE.CylinderGeometry(radius, radius, 1.4, 8);
  coreGeo.rotateX(Math.PI / 2);
  laserGroup.add(new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: isSuper ? 0xffea00 : 0xffffff })));

  laserGroup.position.copy(camera.position).addScaledVector(direction, 0.6);
  laserGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  scene.add(laserGroup);

  lasers.push({ group: laserGroup, direction, speed: isSuper ? 60 : 45, life: 1.5, isSuper });
}

function createExplosion(position) {
  // Shockwave expansiva
  const waveGeo = new THREE.SphereGeometry(0.2, 16, 16);
  const waveMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e, wireframe: true, transparent: true, opacity: 1 });
  const waveMesh = new THREE.Mesh(waveGeo, waveMat);
  waveMesh.position.copy(position);
  scene.add(waveMesh);

  let waveSize = 0.2;
  const waveInterval = setInterval(() => {
    waveSize += 0.8;
    waveMesh.scale.set(waveSize, waveSize, waveSize);
    waveMat.opacity -= 0.1;
    if (waveMat.opacity <= 0) {
      clearInterval(waveInterval);
      scene.remove(waveMesh);
    }
  }, 25);

  // Impulso radial masivo sobre objetos cercanos
  physicalObjects.forEach((item) => {
    const p = item.body.translation();
    const dist = Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z);
    if (dist < 8.0) {
      const force = (8.0 - dist) * 8.0;
      item.body.applyImpulse({
        x: (p.x - position.x) * force,
        y: (p.y - position.y) * force + 10,
        z: (p.z - position.z) * force
      }, true);
    }
  });
}

function updateLasers(deltaTime) {
  const meshes = physicalObjects.map((item) => item.mesh);
  for (let i = lasers.length - 1; i >= 0; i--) {
    const laser = lasers[i];
    const distance = laser.speed * deltaTime;
    const ray = new THREE.Raycaster(laser.group.position, laser.direction, 0, distance + 0.5);
    const hit = ray.intersectObjects(meshes, false)[0];

    if (hit) {
      const item = physicalObjects.find((entry) => entry.mesh === hit.object);
      if (item) {
        if (laser.isSuper) {
          createExplosion(hit.point);
        } else {
          item.body.applyImpulse({ x: laser.direction.x * 16, y: laser.direction.y * 16 + 3, z: laser.direction.z * 16 }, true);
          item.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * 5, y: (Math.random() - 0.5) * 5, z: (Math.random() - 0.5) * 5 }, true);
        }
      }
      scene.remove(laser.group);
      lasers.splice(i, 1);
      continue;
    }

    laser.group.position.addScaledVector(laser.direction, distance);
    laser.life -= deltaTime;
    if (laser.life <= 0) {
      scene.remove(laser.group);
      lasers.splice(i, 1);
    }
  }
}

function syncPhysics() {
  physicalObjects.forEach((item) => {
    const p = item.body.translation();
    const q = item.body.rotation();

    if (p.y < -12) {
      item.body.setTranslation({ x: item.initialPos.x, y: item.initialPos.y + 0.5, z: item.initialPos.z }, true);
      item.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    } else {
      item.mesh.position.set(p.x, p.y, p.z);
      item.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  });
}

// Eventos de teclado e interacción
document.addEventListener('keydown', (event) => {
  keyStates[event.code] = true;
  if (event.code === 'KeyR') clearAndSpawnShapes(); // Respawn de figuras
  if (event.code === 'KeyE') shootLaser(true);      // Disparo de Super Bomba
});

document.addEventListener('keyup', (event) => keyStates[event.code] = false);

renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock();
});

document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  camera.rotation.y -= event.movementX / 500;
  camera.rotation.x -= event.movementY / 500;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x, -Math.PI / 2, Math.PI / 2);
});

document.addEventListener('mousedown', (event) => {
  if (event.button === 0) shootLaser(false);
});

function animate() {
  const delta = Math.min(0.05, clock.getDelta());
  controls(delta);
  updatePlayer(delta);
  physicsWorld.timestep = delta;
  physicsWorld.step();
  syncPhysics();
  updateLasers(delta);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});