import * as THREE from 'three';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { Octree } from 'three/addons/math/Octree.js';

import { Capsule } from 'three/addons/math/Capsule.js';

import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat';


await RAPIER.init();


const container = document.getElementById('scene-container');

const scene = new THREE.Scene();

scene.background = new THREE.Color(0x07111f);

scene.fog = new THREE.Fog(0x07111f, 18, 65);


const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);

camera.rotation.order = 'YXZ';


const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

renderer.setSize(window.innerWidth, window.innerHeight);

renderer.shadowMap.enabled = true;

renderer.shadowMap.type = THREE.PCFSoftShadowMap;

container.appendChild(renderer.domElement);


scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x182030, 1.8));

const sun = new THREE.DirectionalLight(0xffffff, 3);

sun.position.set(-5, 18, 6);

sun.castShadow = true;

sun.shadow.mapSize.set(2048, 2048);

scene.add(sun);


const timer = new THREE.Timer();

const worldOctree = new Octree();

const playerCollider = new Capsule(

  new THREE.Vector3(0, 0.35, 0),

  new THREE.Vector3(0, 1, 0),

  0.35

);

const playerVelocity = new THREE.Vector3();

const playerDirection = new THREE.Vector3();

const keyStates = {};

let playerOnFloor = false;


const gravity = { x: 0, y: -9.81, z: 0 };

const physicsWorld = new RAPIER.World(gravity);

const physicalObjects = [];

const lasers = [];


// Piso físico para los objetos dinámicos.

const groundDesc = RAPIER.ColliderDesc.cuboid(30, 0.1, 30)

  .setTranslation(0, -0.1, 0)

  .setFriction(0.8);

physicsWorld.createCollider(groundDesc);


function createDynamicBox(x, y, z, sx, sy, sz, mass = 4) {

  const mesh = new THREE.Mesh(

    new THREE.BoxGeometry(sx, sy, sz),

    new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.65, metalness: 0.08 })

  );

  mesh.position.set(x, y, z);

  mesh.castShadow = true;

  mesh.receiveShadow = true;

  scene.add(mesh);


  const body = physicsWorld.createRigidBody(

    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z)

  );

  const collider = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)

    .setDensity(mass / Math.max(sx * sy * sz, 0.01))

    .setFriction(0.7)

    .setRestitution(0.12);

  physicsWorld.createCollider(collider, body);

  physicalObjects.push({ mesh, body });

}


// Torre de objetos derribables.

for (let level = 0; level < 3; level++) {

  for (let i = 0; i < 3 - level; i++) {

    createDynamicBox(-2 + i * 1.15 + level * 0.55, 0.5 + level, -5, 1, 1, 1, 4);

  }

}

createDynamicBox(3, 0.75, -5, 1.2, 1.5, 1.2, 8);

createDynamicBox(4.4, 0.4, -5, 0.8, 0.8, 0.8, 2);


// Escenario base utilizado por games_fps.

const loader = new GLTFLoader();

loader.load('./assets/models/collision-world.glb', (gltf) => {

  const model = gltf.scene;

  model.traverse((child) => {

    if (child.isMesh) {

      child.castShadow = true;

      child.receiveShadow = true;

      if (child.material?.map) child.material.map.anisotropy = 4;

    }

  });

  scene.add(model);

  worldOctree.fromGraphNode(model);

}, undefined, (error) => console.error('Error al cargar el escenario:', error));


function getForwardVector() {

  camera.getWorldDirection(playerDirection);

  playerDirection.y = 0;

  return playerDirection.normalize();

}


function getSideVector() {

  camera.getWorldDirection(playerDirection);

  playerDirection.y = 0;

  playerDirection.normalize();

  playerDirection.cross(camera.up);

  return playerDirection;

}


function controls(deltaTime) {

  const speed = playerOnFloor ? 18 : 7;

  if (keyStates.KeyW) playerVelocity.add(getForwardVector().multiplyScalar(speed * deltaTime));

  if (keyStates.KeyS) playerVelocity.add(getForwardVector().multiplyScalar(-speed * deltaTime));

  if (keyStates.KeyA) playerVelocity.add(getSideVector().multiplyScalar(-speed * deltaTime));

  if (keyStates.KeyD) playerVelocity.add(getSideVector().multiplyScalar(speed * deltaTime));

  if (playerOnFloor && keyStates.Space) playerVelocity.y = 7;

}


function playerCollisions() {

  const result = worldOctree.capsuleIntersect(playerCollider);

  playerOnFloor = false;

  if (result) {

    playerOnFloor = result.normal.y > 0;

    if (!playerOnFloor) {

      playerVelocity.addScaledVector(result.normal, -result.normal.dot(playerVelocity));

    }

    playerCollider.translate(result.normal.multiplyScalar(result.depth));

  }

}


function pushNearbyObjects() {

  const moving = new THREE.Vector3(playerVelocity.x, 0, playerVelocity.z);

  if (moving.lengthSq() < 0.04) return;

  for (const item of physicalObjects) {

    const p = item.body.translation();

    const dx = p.x - camera.position.x;

    const dz = p.z - camera.position.z;

    const d = Math.hypot(dx, dz);

    if (d < 1.15) {

      const force = 0.7 / Math.max(d, 0.25);

      item.body.applyImpulse({ x: dx * force, y: 0.05, z: dz * force }, true);

    }

  }

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


function shootLaser() {

  if (document.pointerLockElement !== renderer.domElement) return;

  const direction = new THREE.Vector3();

  camera.getWorldDirection(direction).normalize();


  const geometry = new THREE.CylinderGeometry(0.035, 0.035, 0.9, 10);

  geometry.rotateX(Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({

    color: 0x67e8f9,

    emissive: 0x22d3ee,

    emissiveIntensity: 5

  });

  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.copy(camera.position).addScaledVector(direction, 0.8);

  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);

  scene.add(mesh);


  lasers.push({ mesh, direction, speed: 32, life: 1.7 });

}


function createImpact(position) {

  const flash = new THREE.PointLight(0x67e8f9, 8, 4, 2);

  flash.position.copy(position);

  scene.add(flash);

  setTimeout(() => scene.remove(flash), 90);

}


function updateLasers(deltaTime) {

  const meshes = physicalObjects.map((item) => item.mesh);

  for (let i = lasers.length - 1; i >= 0; i--) {

    const laser = lasers[i];

    const distance = laser.speed * deltaTime;

    const ray = new THREE.Raycaster(laser.mesh.position, laser.direction, 0, distance + 0.5);

    const hit = ray.intersectObjects(meshes, false)[0];


    if (hit) {

      const item = physicalObjects.find((entry) => entry.mesh === hit.object);

      if (item) {

        item.body.applyImpulse({

          x: laser.direction.x * 9,

          y: laser.direction.y * 9 + 1.2,

          z: laser.direction.z * 9

        }, true);

      }

      createImpact(hit.point);

      scene.remove(laser.mesh);

      lasers.splice(i, 1);

      continue;

    }


    laser.mesh.position.addScaledVector(laser.direction, distance);

    laser.life -= deltaTime;

    if (laser.life <= 0) {

      scene.remove(laser.mesh);

      lasers.splice(i, 1);

    }

  }

}


function syncPhysics() {

  for (const item of physicalObjects) {

    const p = item.body.translation();

    const q = item.body.rotation();

    item.mesh.position.set(p.x, p.y, p.z);

    item.mesh.quaternion.set(q.x, q.y, q.z, q.w);

  }

}


document.addEventListener('keydown', (event) => keyStates[event.code] = true);

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

  if (event.button === 0) shootLaser();

});


function animate() {

  timer.update();

  const delta = Math.min(0.05, timer.getDelta());

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