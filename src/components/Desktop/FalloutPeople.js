'use client';

import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useSession } from 'next-auth/react';
import * as THREE from 'three';

const lerpNumber = (a, b, t) => a + (b - a) * t;

const WORLD_WIDTH = 2500;
const WORLD_DEPTH = 1800;
const HALF_WORLD_WIDTH = WORLD_WIDTH / 2;
const HALF_WORLD_DEPTH = WORLD_DEPTH / 2;

// Procedural Height Function for consistent terrain across components
const getTerrainHeight = (x, z) => {
  // Far distant mountains — huge scale, slow amplitude
  const mountains = (Math.sin(x * 0.001) + Math.cos(z * 0.001)) * 120;
  // Local hills — smaller scale, medium amplitude
  const hills = (Math.sin(x * 0.005) * Math.cos(z * 0.005)) * 40;
  // Jitter for 'rough' feel
  const detail = (Math.sin(x * 0.02) + Math.cos(z * 0.02)) * 5;
  
  // Flatten center slightly for the village
  const distFromCenter = Math.sqrt(x*x + z*z);
  const factor = Math.min(1, Math.pow(distFromCenter / 1200, 2.5));
  
  return (mountains + hills + detail) * factor - 10;
};

const clampStrikeTarget = ({ x, z }) => ({
  x: Math.max(-HALF_WORLD_WIDTH, Math.min(HALF_WORLD_WIDTH, x)),
  z: Math.max(-HALF_WORLD_DEPTH, Math.min(HALF_WORLD_DEPTH, z))
});

const getTerrainPointFromRay = (ray, maxDistance = 12000, steps = 96) => {
  if (!ray) return null;

  const samplePoint = new THREE.Vector3();
  let previousT = 0;
  let previousDiff = ray.origin.y - getTerrainHeight(ray.origin.x, ray.origin.z);

  for (let i = 1; i <= steps; i++) {
    const t = (maxDistance * i) / steps;
    samplePoint.copy(ray.direction).multiplyScalar(t).add(ray.origin);
    const terrainY = getTerrainHeight(samplePoint.x, samplePoint.z);
    const diff = samplePoint.y - terrainY;

    if ((previousDiff >= 0 && diff <= 0) || (previousDiff <= 0 && diff >= 0)) {
      let low = previousT;
      let high = t;
      for (let j = 0; j < 9; j++) {
        const mid = (low + high) * 0.5;
        samplePoint.copy(ray.direction).multiplyScalar(mid).add(ray.origin);
        const midDiff = samplePoint.y - getTerrainHeight(samplePoint.x, samplePoint.z);
        if (midDiff > 0) low = mid;
        else high = mid;
      }
      samplePoint.copy(ray.direction).multiplyScalar(high).add(ray.origin);
      const hit = clampStrikeTarget({ x: samplePoint.x, z: samplePoint.z });
      return {
        x: hit.x,
        y: getTerrainHeight(hit.x, hit.z),
        z: hit.z
      };
    }

    previousT = t;
    previousDiff = diff;
  }

  return null;
};

const getVaultEntryPoint = (bunker) => ({
  x: bunker.x,
  z: bunker.z + 42
});

const getDeployAngle = (bunker, target) => {
  if (!bunker || !target) return -Math.PI / 2;
  return Math.atan2(target.z - bunker.z, target.x - bunker.x);
};

const PLANE_MODEL_SCALE = 0.6;
const PLANE_BOMB_BAY_OFFSET = { x: -10, y: -13, z: 0 };
const BOMB_DROP_GRAVITY = 2.5;
const BOMB_RENDER_SCALE = 3.2;
const BOMB_PARACHUTE_DEPLOY_DELAY = 0.08;
const BOMB_PARACHUTE_FALL_SPEED = 2.5;
const BOMB_PARACHUTE_GLIDE_SPEED = 4.1;
const BOMB_TARGET_PROXIMITY = 14;
const BOMB_PARACHUTE_SWAY_SPEED = 2.1;
const BOMB_PARACHUTE_SWAY_AMOUNT = 1.8;
const BOMB_IMPACT_DELAY = 0.22;
const BOMB_CAM_STEER_SPEED = 110;
const BOMB_CAM_CAMERA_LERP = 0.18;
const BOMB_CAM_LOOK_LERP = 0.22;
const BOMB_CAM_LOOK_AHEAD = 160;
const BOMB_CAM_CAMERA_HEIGHT = 8;
const BOMB_CAM_CAMERA_FORWARD_OFFSET = 10;
const PLANE_BASE_ALTITUDE = 350;
const PLANE_ALTITUDE_VARIANCE = 80;
const PLANE_START_DISTANCE = WORLD_WIDTH * 1.5;
const PLANE_BANK_LIMIT = 0.22;
const AIRSTRIKE_DEBUG = false;
const AUTO_AIRSTRIKES_ENABLED = false;
const TARGET_INDICATOR_HEIGHT = 8;
const MANUAL_STRIKE_COOLDOWN_MS = 5000;
const NUKE_MUSHROOM_BASE_SCALE = 1.35;
const NUKE_DESTRUCTION_PREVIEW_RADIUS = 360;
const NUKE_SEVERE_PREVIEW_RADIUS = 200;
const NUKE_CASUALTY_PREVIEW_RADIUS = 240;
const STARTING_COMMAND_CREDITS = 280;
const COMMAND_CREDIT_CAP = 720;
const COMMAND_INCOME_PER_SECOND = 8;
const COMMAND_BUNKER_BONUS_PER_SECOND = 3;
const TOTAL_KAIJU_LEVELS = 5;
const LEVEL_INTERMISSION_SECONDS = 5;
const LEVEL_CLEAR_CREDIT_REWARD = 130;
const LEVEL_CLEAR_BUNKER_REPAIR = 180;
const MANUAL_STRIKE_COST = 95;
const CIVILIAN_RESCUE_REWARD = 8;
const KAIJU_KILL_REWARD = 110;
const MINI_MONSTER_KILL_REWARD = 42;
const BUNKER_KAIJU_DAMAGE = 26;
const BARRICADE_KAIJU_DAMAGE = 34;
const KAIJU_FRAME_RATE_REFERENCE = 60;
const KAIJU_GLOBAL_MOVE_MULTIPLIER = 0.78;
const KAIJU_MINI_MOVE_MULTIPLIER = 0.62;
const KAIJU_WANDER_MOVE_MULTIPLIER = 0.7;
const KAIJU_ATTACK_RATE_MULTIPLIER = 0.76;
const KAIJU_COLLATERAL_DAMAGE_INTERVAL = 0.24;
const BARRICADE_LIFETIME_MS = 38000;
const BARRICADE_MAX_HP = 860;
const DEPLOY_OPTIONS = {
  squad: { label: 'Rangers', icon: '🪖', cost: 28, countLabel: 'x4', description: 'Cheap rifle squad that holds the line.' },
  gunner_team: { label: 'Gunner Team', icon: '🔫', cost: 44, countLabel: 'x3', description: 'Auto-rifle team with stronger close suppression.' },
  sniper_team: { label: 'Sniper Team', icon: '🎯', cost: 52, countLabel: 'x2', description: 'Long-range marksmen for high-value kaiju damage.' },
  engineer_team: { label: 'Engineers', icon: '🛠️', cost: 48, countLabel: 'x2', description: 'Support crew that repairs vaults and defenses.' },
  barricade: { label: 'Barricade', icon: '🧱', cost: 40, countLabel: 'x1', description: 'Temporary wall that slows kaiju pushes.' },
  tank: { label: 'Tank', icon: '🚜', cost: 72, countLabel: 'x1', description: 'Strong anti-kaiju armor for mid range.' },
  apc: { label: 'APC', icon: '🚛', cost: 96, countLabel: 'x1', description: 'Fast support armor that repositions and fires quickly.' },
  jet: { label: 'Jet', icon: '✈️', cost: 120, countLabel: 'x1', description: 'Fast strike support against wounded targets.' }
};
const BUILD_OPTIONS = {
  powerplant: {
    label: 'Power Plant',
    icon: '⚡',
    cost: 130,
    description: 'Adds +4 income per second.'
  },
  war_factory: {
    label: 'War Factory',
    icon: '🏭',
    cost: 190,
    requires: ['powerplant'],
    description: 'Unlocks tank deployment.'
  },
  aa_site: {
    label: 'AA Battery',
    icon: '🛡️',
    cost: 170,
    requires: ['war_factory'],
    description: 'Ground-to-air turret that can hit flying kaiju.'
  },
  field_hospital: {
    label: 'Field Hospital',
    icon: '⛑️',
    cost: 160,
    requires: ['powerplant'],
    description: 'Slowly heals bunkers and frontline units nearby.'
  },
  tech_lab: {
    label: 'Tech Lab',
    icon: '🛰️',
    cost: 240,
    requires: ['powerplant', 'war_factory'],
    description: 'Unlocks jet support and advanced upgrades.'
  },
  radar_tower: {
    label: 'Radar Tower',
    icon: '📡',
    cost: 210,
    requires: ['tech_lab'],
    description: 'Improves command control and reduces nuke rearm time.'
  }
};
const UPGRADE_OPTIONS = {
  tank_mk2: {
    label: 'Tank MK-II',
    icon: '🔧',
    cost: 165,
    requires: ['war_factory', 'tech_lab'],
    description: 'Tanks gain stronger shells and faster reload.'
  },
  ranger_drill: {
    label: 'Ranger Drill',
    icon: '🎖️',
    cost: 150,
    requires: ['field_hospital', 'tech_lab'],
    description: 'Infantry fire faster and survive a little longer.'
  }
};
const DEPLOY_UNLOCK_REQUIREMENTS = {
  squad: [],
  gunner_team: ['powerplant'],
  sniper_team: ['tech_lab'],
  engineer_team: ['powerplant'],
  barricade: [],
  tank: ['war_factory'],
  apc: ['war_factory', 'field_hospital'],
  jet: ['tech_lab']
};
const DEFAULT_BUILDINGS = Object.freeze({
  powerplant: false,
  war_factory: false,
  aa_site: false,
  field_hospital: false,
  tech_lab: false,
  radar_tower: false
});
const DEFAULT_UPGRADES = Object.freeze({
  tank_mk2: false,
  ranger_drill: false
});
const POWERPLANT_INCOME_BONUS = 4;
const RADAR_TOWER_INCOME_BONUS = 2;
const TANK_MK2_DAMAGE_MULTIPLIER = 1.65;
const TANK_MK2_RELOAD_MULTIPLIER = 1.25;
const APC_DAMAGE_MULTIPLIER = 0.82;
const APC_RELOAD_MULTIPLIER = 1.42;
const APC_SPEED_MULTIPLIER = 1.18;
const DEPLOY_PROTECTION_MS = 4200;
const DEPLOY_PROTECTION_DAMAGE_MULTIPLIER = 0.32;
const TANK_BASE_HP = 320;
const APC_BASE_HP = 380;
const AA_SITE_DAMAGE = 21;
const AA_SITE_RANGE = 560;
const AA_SITE_RELOAD_TIME = 0.34;
const HOSPITAL_HEAL_RANGE = 300;
const HOSPITAL_BUNKER_HEAL_PER_SECOND = 7;
const HOSPITAL_UNIT_HEAL_PER_SECOND = 9;
const ENGINEER_REPAIR_RANGE = 210;
const ENGINEER_REPAIR_RATE = 22;
const ENGINEER_BARRICADE_REPAIR_RATE = 28;
const ENGINEER_ARMOR_REPAIR_RATE = 18;
const ENGINEER_BUILD_BOOST_PER_ENGINEER = 0.85;
const ENGINEER_BARRICADE_REBUILD_COOLDOWN = 14000;
const RADAR_NUKE_COOLDOWN_MULTIPLIER = 0.76;
const RANGER_DRILL_DAMAGE_MULTIPLIER = 1.14;
const RANGER_DRILL_FIRE_MULTIPLIER = 1.15;
const RANGER_DRILL_HP_BONUS = 8;
const FACILITY_BUILD_DURATION = 5.8;
const FACILITY_BUILD_MIN_DISTANCE = 30;
const FACILITY_BUILD_MAX_DISTANCE = 920;
const FACILITY_BUILD_MIN_SPACING = 54;
const NUKE_AFTERFIRE_PATCH_COUNT = 4;
const NUKE_AFTERFIRE_PATCH_TTL = 11;
const NUKE_AFTERFIRE_CORE_LIFETIME = 14;

const cloneDefaultBuildings = () => ({ ...DEFAULT_BUILDINGS });
const cloneDefaultUpgrades = () => ({ ...DEFAULT_UPGRADES });
const cloneDefaultBuildQueue = () => Object.fromEntries(Object.keys(DEFAULT_BUILDINGS).map((key) => [key, false]));
const getBuildPlacementState = (buildings = DEFAULT_BUILDINGS, buildQueue = {}) => {
  const merged = { ...buildings };
  Object.keys(buildQueue || {}).forEach((key) => {
    if (buildQueue[key]) merged[key] = true;
  });
  return merged;
};
const hasPrerequisites = (stateMap, requirements = []) => requirements.every((key) => !!stateMap?.[key]);
const getDeployUnlockState = (buildings = DEFAULT_BUILDINGS) => ({
  squad: true,
  gunner_team: hasPrerequisites(buildings, DEPLOY_UNLOCK_REQUIREMENTS.gunner_team),
  sniper_team: hasPrerequisites(buildings, DEPLOY_UNLOCK_REQUIREMENTS.sniper_team),
  engineer_team: hasPrerequisites(buildings, DEPLOY_UNLOCK_REQUIREMENTS.engineer_team),
  barricade: true,
  tank: hasPrerequisites(buildings, DEPLOY_UNLOCK_REQUIREMENTS.tank),
  apc: hasPrerequisites(buildings, DEPLOY_UNLOCK_REQUIREMENTS.apc),
  jet: hasPrerequisites(buildings, DEPLOY_UNLOCK_REQUIREMENTS.jet)
});

const KAIJU_BASE_HP = 1950;
const BUNKER_BASE_HP = 2600;
const TANK_SHELL_DAMAGE = 12;
const SOLDIER_RIFLE_DAMAGE = 0.75;
const JET_MISSILE_DAMAGE = 170;
const SOLDIER_LOADOUTS = [
  {
    key: 'rifleman',
    label: 'Rifle',
    hp: 84,
    attackRange: 180,
    idealRange: 130,
    retreatRange: 72,
    attackDamage: 1.15,
    fireRate: 0.09,
    moveSpeed: 2.8,
    color: '#166534'
  },
  {
    key: 'marksman',
    label: 'Long Range',
    hp: 72,
    attackRange: 260,
    idealRange: 205,
    retreatRange: 120,
    attackDamage: 2.05,
    fireRate: 0.055,
    moveSpeed: 2.45,
    color: '#14532d'
  },
  {
    key: 'gunner',
    label: 'Auto Rifle',
    hp: 96,
    attackRange: 155,
    idealRange: 110,
    retreatRange: 65,
    attackDamage: 0.82,
    fireRate: 0.17,
    moveSpeed: 2.6,
    color: '#3f6212'
  },
  {
    key: 'engineer',
    label: 'Engineer',
    hp: 88,
    attackRange: 120,
    idealRange: 100,
    retreatRange: 60,
    attackDamage: 0.45,
    fireRate: 0.045,
    moveSpeed: 2.6,
    color: '#0f766e'
  }
];
const KAIJU_VARIANT_CONFIG = {
  godzilla: { displayName: 'godzilla', hpMult: 1.12, scaleMin: 4.2, scaleMax: 6.3, moveMult: 0.84, attackMult: 0.9 },
  octopus: { displayName: 'octopus', hpMult: 0.96, scaleMin: 3.9, scaleMax: 5.8, moveMult: 0.8, attackMult: 0.86 },
  spider: { displayName: 'spider', hpMult: 0.92, scaleMin: 3.7, scaleMax: 5.9, moveMult: 0.88, attackMult: 0.9 },
  beetle: { displayName: 'titan beetle', hpMult: 1.08, scaleMin: 4.1, scaleMax: 6.1, moveMult: 0.82, attackMult: 0.92 },
  wyrm: { displayName: 'ash wyrm', hpMult: 1.02, scaleMin: 4.4, scaleMax: 6.4, moveMult: 0.8, attackMult: 0.9 },
  spicie_bird: {
    displayName: 'spicie bird',
    hpMult: 0.88,
    scaleMin: 3.8,
    scaleMax: 5.5,
    moveMult: 0.72,
    attackMult: 0.84,
    flying: true,
    cruiseHeight: 130
  }
};
const KAIJU_VARIANT_POOLS = [
  ['godzilla', 'octopus', 'spider'],
  ['godzilla', 'octopus', 'spider', 'beetle'],
  ['godzilla', 'octopus', 'spider', 'beetle', 'wyrm', 'spicie_bird']
];
const DYNAMIC_RENDER_TYPES = new Set([
  'plane', 'bomb', 'kaiju', 'mushroom', 'kaiju_attack', 'firebreath',
  'bullet', 'shell', 'jet', 'missile', 'missile_impact', 'impact_puff',
  'barricade', 'facility', 'soldier', 'tank',
  'muzzle_flash', 'corpse', 'kaiju_corpse', 'scorch'
]);

const getPlaneBombSpawnPosition = (plane) => {
  const yaw = -Math.atan2(plane.vz || 0, plane.vx || 0.001);
  const localX = PLANE_BOMB_BAY_OFFSET.x * PLANE_MODEL_SCALE;
  const localY = PLANE_BOMB_BAY_OFFSET.y * PLANE_MODEL_SCALE;
  const localZ = PLANE_BOMB_BAY_OFFSET.z * PLANE_MODEL_SCALE;

  return {
    x: plane.x + localX * Math.cos(yaw) + localZ * Math.sin(yaw),
    y: (plane.y || 350) + localY,
    z: plane.z - localX * Math.sin(yaw) + localZ * Math.cos(yaw)
  };
};

const createBombFromPlane = (plane) => {
  const spawn = getPlaneBombSpawnPosition(plane);

  return {
    id: `bomb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'bomb',
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    vx: (plane.vx || 0) * 0.45,
    vy: -8,
    vz: (plane.vz || 0) * 0.45,
    grav: 0.18,
    targetX: plane.dropX,
    targetZ: plane.dropZ,
    age: 0,
    parachuteOpen: false,
    deployDelay: BOMB_PARACHUTE_DEPLOY_DELAY,
    fallSpeed: BOMB_PARACHUTE_FALL_SPEED,
    glideSpeed: BOMB_PARACHUTE_GLIDE_SPEED,
    targetProximity: BOMB_TARGET_PROXIMITY,
    swaySeed: Math.random() * Math.PI * 2,
    chuteInflation: 0,
    swayAmount: 0,
    impactDelay: BOMB_IMPACT_DELAY,
    impactPending: false,
    isManual: !!plane.isManual,
    controlStrength: plane.isManual ? BOMB_CAM_STEER_SPEED : 0,
    dead: false
  };
};

const debugAirstrikeLog = (...args) => {
  if (AIRSTRIKE_DEBUG) {
    console.log(...args);
  }
};

const getKaijuVariantPoolForLevel = (level) => (
  KAIJU_VARIANT_POOLS[Math.min(KAIJU_VARIANT_POOLS.length - 1, Math.max(0, level - 1))]
);

const getWaveKaijuCount = (level, maxKaijus) => {
  const guaranteed = 1 + Math.floor((level - 1) / 2);
  const surgeChance = Math.min(0.55, 0.1 + level * 0.08);
  const surge = Math.random() < surgeChance ? 1 : 0;
  return Math.max(1, Math.min(maxKaijus, guaranteed + surge));
};

const getKaijuDisplayName = (variant) => (
  KAIJU_VARIANT_CONFIG[variant]?.displayName || variant
);

const getKaijuVariantTuning = (variant) => (
  KAIJU_VARIANT_CONFIG[variant] || KAIJU_VARIANT_CONFIG.godzilla
);

const getFrameScaledStep = (delta, referenceFps = KAIJU_FRAME_RATE_REFERENCE) => (
  THREE.MathUtils.clamp((delta || 1 / referenceFps) * referenceFps, 0.55, 1.6)
);

const getKaijuSizeSpeedFactor = (kaiju) => {
  const scale = Math.max(1.65, kaiju?.scale || 5);
  const rawFactor = 5 / scale;
  return THREE.MathUtils.clamp(rawFactor, 0.62, kaiju?.isMini ? 1.22 : 1.04);
};

const formatSectorName = (name = 'village') => (
  name === 'militarybase'
    ? 'Military Base'
    : name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (char) => char.toUpperCase())
);

const pickRandomSectorName = (excludeName = '') => {
  const fallback = formatSectorName(THEMES[0]?.name || 'village');
  const pool = THEMES
    .map((theme) => theme?.name)
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index && name !== excludeName);
  if (!pool.length) return fallback;
  return formatSectorName(pool[Math.floor(Math.random() * pool.length)]);
};

const isKaijuDefeated = (kaiju) => !!kaiju && (kaiju.dead || kaiju.state === 'dying' || kaiju.hp <= 0);

const isFlyingKaijuVariant = (variant) => !!KAIJU_VARIANT_CONFIG[variant]?.flying;

const isFlyingKaiju = (kaiju) => !!kaiju && kaiju.type === 'kaiju' && isFlyingKaijuVariant(kaiju.variant);
const isBrokenStructure = (entity) => !!entity && (entity.state === 'broken' || entity.destroyed || (entity.hp ?? 1) <= 0);
const markStructureBroken = (entity) => {
  if (!entity) return;
  entity.hp = 0;
  entity.state = 'broken';
  entity.destroyed = true;
  entity.dead = true;
  entity.constructing = false;
  entity.destroyedAt = entity.destroyedAt || Date.now();
};

const getKaijuSpawnY = (variant, x, z, isMini = false) => {
  const terrainY = getTerrainHeight(x, z);
  if (!isFlyingKaijuVariant(variant)) return terrainY;
  const cruiseHeight = KAIJU_VARIANT_CONFIG[variant]?.cruiseHeight || 120;
  const miniOffset = isMini ? -24 : 0;
  return terrainY + cruiseHeight + miniOffset + Math.random() * 26;
};

const markKaijuDefeated = (kaiju) => {
  if (!kaiju) return;
  kaiju.hp = 0;
  kaiju.vx = 0;
  kaiju.vz = 0;
  kaiju.staggered = false;
  kaiju.staggerTimer = 0;
  if (kaiju.state !== 'dead' && kaiju.state !== 'dying') {
    kaiju.state = 'dying';
    kaiju.deathStartedAt = Date.now();
  }
};

const getSoldierLoadout = (seed = 0) => {
  if (typeof seed === 'string') {
    const named = SOLDIER_LOADOUTS.find((loadout) => loadout.key === seed);
    if (named) return named;
  }
  return SOLDIER_LOADOUTS[Math.abs(Number(seed) || 0) % SOLDIER_LOADOUTS.length];
};

const applySoldierLoadout = (entity, seed = 0) => {
  const loadout = getSoldierLoadout(seed);
  entity.type = 'soldier';
  entity.weaponType = loadout.key;
  entity.weaponLabel = loadout.label;
  entity.attackRange = loadout.attackRange;
  entity.idealRange = loadout.idealRange;
  entity.retreatRange = loadout.retreatRange;
  entity.attackDamage = loadout.attackDamage;
  entity.fireRate = loadout.fireRate;
  entity.combatSpeed = loadout.moveSpeed;
  entity.hp = loadout.hp;
  entity.maxHp = loadout.hp;
  entity.color = loadout.color;
  entity.dead = false;
  return entity;
};

const applySoldierTrainingBonuses = (entity, upgrades = DEFAULT_UPGRADES) => {
  if (!entity || entity.type !== 'soldier') return entity;
  if (upgrades?.ranger_drill) {
    const nextMaxHp = (entity.maxHp || entity.hp || 50) + RANGER_DRILL_HP_BONUS;
    entity.attackDamage = (entity.attackDamage || SOLDIER_RIFLE_DAMAGE) * RANGER_DRILL_DAMAGE_MULTIPLIER;
    entity.fireRate = (entity.fireRate || 0.08) * RANGER_DRILL_FIRE_MULTIPLIER;
    entity.maxHp = nextMaxHp;
    entity.hp = Math.min(nextMaxHp, (entity.hp || nextMaxHp) + RANGER_DRILL_HP_BONUS);
  }
  return entity;
};

const damageSoldier = (entity, damage, entities) => {
  if (!entity || entity.dead) return;
  const reducedDamage = entity.deployShieldUntil && entity.deployShieldUntil > Date.now()
    ? damage * DEPLOY_PROTECTION_DAMAGE_MULTIPLIER
    : damage;
  entity.hp = Math.max(0, (entity.hp ?? entity.maxHp ?? 45) - reducedDamage);
  entity.hurtTimer = 0.45;
  if (entity.hp <= 0) {
    entity.dead = true;
    if (!entity.corpseSpawned) {
      entities.push(createCorpseEntity(entity));
      entity.corpseSpawned = true;
    }
    AudioManager.play('scream');
  }
};

const damageTank = (entity, damage, options = {}) => {
  if (!entity || entity.dead) return;
  const { breakOnHit = false, bypassShield = false, minimumHp = 0 } = options;
  const reducedDamage = !bypassShield && entity.deployShieldUntil && entity.deployShieldUntil > Date.now()
    ? damage * DEPLOY_PROTECTION_DAMAGE_MULTIPLIER
    : damage;
  const maxHp = entity.maxHp || (entity.variant === 'apc' ? APC_BASE_HP : TANK_BASE_HP);
  entity.maxHp = maxHp;
  entity.hp = Math.max(minimumHp, (entity.hp ?? maxHp) - reducedDamage);
  entity.hurtTimer = 0.42;
  entity.lastDamagedAt = Date.now();
  if (breakOnHit || entity.hp / Math.max(1, maxHp) <= 0.22) {
    entity.state = 'broken';
  }
  if (entity.hp <= 0) {
    entity.hp = 0;
    entity.state = 'broken';
    entity.dead = true;
  }
};

const DEFAULT_FALLOUT_PROGRESS = {
  highestLevelReached: 1,
  currentLevel: 1,
  totalWins: 0,
  totalLosses: 0,
  totalGamesPlayed: 0,
  totalNukesLaunched: 0,
  totalKaijuKilled: 0,
  lastOutcome: 'playing',
  lastTheme: 'village',
  lastStats: {}
};

const getTrackedEntity = ({ entitiesRef, entityLookupRef, entityId, index }) => {
  if (entityId) {
    const tracked = entityLookupRef?.current?.get(entityId);
    if (tracked) return tracked;

    const fallback = entitiesRef.current.find(entity => entity.id === entityId);
    if (fallback) return fallback;
  }

  return index === undefined ? undefined : entitiesRef.current[index];
};

const getDynamicEntitySignature = (entities) => {
  let hash = 2166136261;
  let count = 0;

  entities.forEach((entity) => {
    if (!DYNAMIC_RENDER_TYPES.has(entity.type)) return;
    count++;
    const type = entity.type || '';
    const id = entity.id || '';
    hash ^= entity.dead ? 1 : 0;
    hash = Math.imul(hash, 16777619);
    for (let i = 0; i < type.length; i++) {
      hash ^= type.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 58;
    hash = Math.imul(hash, 16777619);
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  });

  return `${count}:${hash >>> 0}`;
};

const createFrameEntitySnapshot = () => ({
  ready: false,
  allKaijus: [],
  aliveKaijus: [],
  groundKaijus: [],
  flyingKaijus: [],
  allBunkers: [],
  aliveBunkers: [],
  liveBarricades: [],
  liveFacilities: [],
  aaSites: [],
  liveTanks: [],
  liveJets: [],
  liveSoldiers: [],
  liveEngineers: [],
  livePersons: [],
  repairTargets: [],
  collateralTargets: []
});

const createPlaneStrikeEntity = ({
  idPrefix = 'plane',
  dropX,
  dropZ,
  angle = Math.random() * Math.PI * 2,
  speed = 4 + Math.random() * 2.5,
  isManual = false
}) => {
  const target = clampStrikeTarget({ x: dropX, z: dropZ });
  const startX = target.x - Math.cos(angle) * PLANE_START_DISTANCE;
  const startZ = target.z - Math.sin(angle) * PLANE_START_DISTANCE;

  return {
    id: `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'plane',
    x: startX,
    y: PLANE_BASE_ALTITUDE + Math.random() * PLANE_ALTITUDE_VARIANCE,
    z: startZ,
    vx: Math.cos(angle) * speed,
    vz: Math.sin(angle) * speed,
    dropped: false,
    dropX: target.x,
    dropZ: target.z,
    dead: false,
    engineSoundTimer: 0,
    minDistToTarget: Infinity,
    prevDist: Infinity,
    attackRunArmed: false,
    isManual
  };
};

const shouldForcePlaneDrop = (plane) => (
  Math.abs(plane.x) > 3500 || Math.abs(plane.z) > 3500
);

const createCorpseEntity = (entity) => ({
  id: `corpse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  type: 'corpse',
  x: entity.x,
  y: 0,
  z: entity.z,
  color: entity.color,
  dead: false
});

const createKaijuCorpseEntity = (entity) => ({
  id: `kaiju-corpse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  type: 'kaiju_corpse',
  x: entity.x,
  y: getTerrainHeight(entity.x, entity.z),
  z: entity.z,
  variant: entity.variant,
  scale: entity.scale || 5,
  rotation: entity.rotation || 0,
  isMini: !!entity.isMini,
  dead: false
});

const pushImpactPuffEntity = (entities, x, z, y = getTerrainHeight(x, z)) => {
  entities.push({
    id: `impact-puff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'impact_puff',
    x,
    y,
    z,
    dead: false
  });
};

const pushScorchEntity = (entities, x, z, radius = 60, options = {}) => {
  entities.push({
    id: `scorch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'scorch',
    x,
    z,
    radius,
    age: 0,
    dead: false,
    ...options
  });
};

const spawnNukeAftermathFires = (entities, x, z, isManual = true) => {
  const coreRadius = isManual ? 112 : 92;
  const patchCount = isManual ? NUKE_AFTERFIRE_PATCH_COUNT + 1 : NUKE_AFTERFIRE_PATCH_COUNT;
  const patchMinRadius = coreRadius * 0.78;
  const patchMaxRadius = isManual ? 240 : 190;

  pushScorchEntity(entities, x, z, coreRadius, {
    kind: 'nuke_core',
    temporary: true,
    ttl: isManual ? NUKE_AFTERFIRE_CORE_LIFETIME : 12,
    baseOpacity: 0.94,
    coreOpacity: 0.56,
    heatOpacity: 0.24,
    burnRadius: isManual ? 230 : 185,
    burnLife: isManual ? NUKE_AFTERFIRE_CORE_LIFETIME : 18,
    smokeCount: isManual ? 5 : 4,
    flameCount: isManual ? 4 : 3,
    smokeDrift: isManual ? 8 : 6,
    firePulseSpeed: 4.6
  });

  for (let i = 0; i < patchCount; i++) {
    const angle = (i / patchCount) * Math.PI * 2 + Math.random() * 0.55;
    const distance = patchMinRadius + Math.random() * (patchMaxRadius - patchMinRadius);
    const patch = clampStrikeTarget({
      x: x + Math.cos(angle) * distance,
      z: z + Math.sin(angle) * distance
    });
    const patchRadius = 18 + Math.random() * (isManual ? 24 : 18);
    pushScorchEntity(entities, patch.x, patch.z, patchRadius, {
      kind: 'nuke_fire_patch',
      temporary: true,
      ttl: (isManual ? NUKE_AFTERFIRE_PATCH_TTL : 13) + Math.random() * 5,
      baseOpacity: 0.76,
      coreOpacity: 0.42,
      heatOpacity: 0.18,
      burnRadius: patchRadius * 3.1,
      burnLife: (isManual ? NUKE_AFTERFIRE_PATCH_TTL : 13) + Math.random() * 2,
      smokeCount: 1 + Math.floor(Math.random() * 2),
      flameCount: 1 + Math.floor(Math.random() * 2),
      smokeDrift: 5 + Math.random() * 3,
      firePulseSpeed: 5.4 + Math.random() * 1.8
    });
  }
};

const applyKaijuCollateralDamage = (entities, source, radius, candidates = entities) => {
  const sourceY = source.y || 0;

  candidates.forEach((entity) => {
    if (
      !entity ||
      entity.dead ||
      entity.id === source.id ||
      entity.type === 'kaiju' ||
      entity.type === 'scorch' ||
      entity.type === 'bomb' ||
      entity.type === 'bunker'
    ) {
      return;
    }

    const entityY = entity.y || 0;
    const d3d = Math.sqrt(
      Math.pow(entity.x - source.x, 2) +
      Math.pow(entityY - sourceY, 2) +
      Math.pow(entity.z - source.z, 2)
    );

    if (d3d >= radius) return;

    if (entity.type === 'house' || entity.type === 'tree') {
      entity.state = 'broken';
    } else if (entity.type === 'tank') {
      damageTank(entity, entity.variant === 'apc' ? 34 : 42);
      AudioManager.play('bomb', { volume: 0.05, duration: 0.14 });
    } else if (entity.type === 'soldier') {
      damageSoldier(entity, 18, entities);
    } else if (entity.type === 'person') {
      entity.dead = true;
      AudioManager.play('scream');
      entities.push(createCorpseEntity(entity));
    } else if (entity.type === 'car') {
      entity.state = 'broken';
    } else {
      entity.dead = true;
    }
  });
};

const spawnKaijuFootfallEffect = (entities, kaiju, side = 1, leaveScorch = false) => {
  const yaw = kaiju.rotation || 0;
  const scale = kaiju.scale || 5;
  const footSpread = Math.max(26, scale * 8.5);
  const forwardReach = Math.max(10, scale * 3.5);
  const sideX = Math.cos(yaw);
  const sideZ = -Math.sin(yaw);
  const forwardX = Math.sin(yaw);
  const forwardZ = Math.cos(yaw);
  const footX = kaiju.x + sideX * footSpread * side + forwardX * forwardReach;
  const footZ = kaiju.z + sideZ * footSpread * side + forwardZ * forwardReach;

  pushImpactPuffEntity(entities, footX, footZ);

  if (leaveScorch) {
    pushScorchEntity(entities, footX, footZ, Math.max(24, scale * 6.5));
  }
};

const spawnKaijuChaosBurst = (entities, kaiju) => {
  const yaw = kaiju.rotation || 0;
  const scale = kaiju.scale || 5;
  const ringCount = kaiju.variant === 'beetle'
    ? 6
    : kaiju.variant === 'wyrm'
      ? 5
      : kaiju.variant === 'spider'
        ? 5
        : kaiju.variant === 'octopus'
          ? 4
          : 3;
  const chaosRadius = kaiju.variant === 'spider'
    ? 120 + scale * 18
    : kaiju.variant === 'octopus'
      ? 140 + scale * 16
      : kaiju.variant === 'beetle'
        ? 130 + scale * 17
        : kaiju.variant === 'wyrm'
          ? 165 + scale * 19
      : 170 + scale * 20;

  AudioManager.play('kaiju_roar');
  AudioManager.play('bomb', { volume: 0.12, duration: 0.22 });

  pushImpactPuffEntity(entities, kaiju.x, kaiju.z, kaiju.y || getTerrainHeight(kaiju.x, kaiju.z));

  for (let i = 0; i < ringCount; i++) {
    const angle = yaw + (i / ringCount) * Math.PI * 2 + (i % 2 === 0 ? 0.22 : -0.22);
    const distance = chaosRadius * (0.78 + (i % 2) * 0.18);
    const burstX = kaiju.x + Math.sin(angle) * distance;
    const burstZ = kaiju.z + Math.cos(angle) * distance;

    pushImpactPuffEntity(entities, burstX, burstZ);
  }

  if (kaiju.variant === 'spider') {
    [-0.45, 0, 0.45].forEach((offset, index) => {
      const angle = yaw + offset;
      const burstX = kaiju.x + Math.sin(angle) * (chaosRadius + 50);
      const burstZ = kaiju.z + Math.cos(angle) * (chaosRadius + 50);

      entities.push({
        id: `attack-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'kaiju_attack',
        variant: 'spider',
        attackType: 'web',
        x: burstX,
        y: getTerrainHeight(burstX, burstZ),
        z: burstZ,
        sourceX: kaiju.x,
        sourceY: (kaiju.y || 0) + 18,
        sourceZ: kaiju.z,
        age: 0,
        dead: false
      });
    });
  } else if (kaiju.variant === 'beetle') {
    [-0.32, 0, 0.32].forEach((offset, index) => {
      const angle = yaw + offset;
      const blastX = kaiju.x + Math.sin(angle) * (chaosRadius * 0.92);
      const blastZ = kaiju.z + Math.cos(angle) * (chaosRadius * 0.92);

      entities.push({
        id: `attack-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'kaiju_attack',
        variant: 'beetle',
        attackType: 'lightning',
        x: blastX,
        y: getTerrainHeight(blastX, blastZ) + 12,
        z: blastZ,
        sourceX: kaiju.x,
        sourceY: (kaiju.y || 0) + 26,
        sourceZ: kaiju.z,
        age: 0,
        dead: false
      });
    });
  } else if (kaiju.variant === 'octopus') {
    const inkX = kaiju.x + Math.sin(yaw) * (chaosRadius * 0.72);
    const inkZ = kaiju.z + Math.cos(yaw) * (chaosRadius * 0.72);

    entities.push({
      id: `attack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'kaiju_attack',
      variant: 'octopus',
      attackType: 'ink',
      x: inkX,
      y: getTerrainHeight(inkX, inkZ),
      z: inkZ,
      sourceX: kaiju.x,
      sourceY: (kaiju.y || 0) + 24,
      sourceZ: kaiju.z,
      age: 0,
      dead: false
    });
  } else {
    const targetX = kaiju.x + Math.sin(yaw) * (chaosRadius + 80);
    const targetZ = kaiju.z + Math.cos(yaw) * (chaosRadius + 80);

    entities.push({
      id: `firebreath-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'firebreath',
      x: kaiju.x,
      y: (kaiju.y || 0) + 40,
      z: kaiju.z,
      targetX,
      targetY: getTerrainHeight(targetX, targetZ) + 20,
      targetZ,
      age: 0,
      dead: false
    });
    AudioManager.play('fire_breath');
  }

  applyKaijuCollateralDamage(entities, kaiju, chaosRadius + 140);
};

// Dynamic Biomes / Themes
const THEMES = [
  {
    name: 'village',
    population: 200, carCount: 15, treeCount: 40, houseCount: 40, birdCount: 30,
    groundColor: '#65a30d', groundPolluted: '#3f3f2d',
    houseColors: ['#fef3c7', '#fcd34d', '#ffedd5'], roofColors: ['#991b1b', '#b45309'],
    carColors: ['#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#111827', '#f8fafc'],
    personColors: ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'],
    skyColor: '#87CEEB', skyPolluted: '#2a2a21',
    sunColor: '#fde047',
    houseScale: 1.5, treeScale: 1, carSpeed: 4
  },
  {
    name: 'city',
    population: 350, carCount: 60, treeCount: 10, houseCount: 80, birdCount: 8,
    groundColor: '#475569', groundPolluted: '#0f172a', // Asphalt / Concrete
    houseColors: ['#94a3b8', '#64748b', '#cbd5e1', '#334155'], roofColors: ['#334155', '#1e293b'], // Skyscrapers
    carColors: ['#000000', '#ffffff', '#facc15', '#facc15', '#ef4444'], // Lots of yellow cabs
    personColors: ['#000000', '#333333', '#111111', '#555555', '#cccccc', '#94a3b8'], // Monotone coats
    skyColor: '#93c5fd', skyPolluted: '#1e1b4b',
    sunColor: '#fef08a',
    houseScale: 4.5, // Tall highrises
    treeScale: 0.8, carSpeed: 6 // Fast traffic
  },
  {
    name: 'militarybase',
    population: 150, carCount: 30, treeCount: 15, houseCount: 35, birdCount: 0,
    groundColor: '#78350f', groundPolluted: '#451a03', // Mud/Dirt
    houseColors: ['#4d7c0f', '#3f6212', '#14532d'], roofColors: ['#3f6212', '#14532d', '#052e16'], // Barracks
    carColors: ['#14532d', '#166534', '#064e3b'], // Army jeeps / trucks
    personColors: ['#14532d', '#166534', '#3f6212', '#78350f', '#000000'], // Camouflage
    skyColor: '#ea580c', skyPolluted: '#451a03', // Orange/muddy sunset
    sunColor: '#fef3c7',
    houseScale: 1.2, treeScale: 1.2, carSpeed: 5 // Escaping!
  }
];

const RESOLUTION_PRESETS = {
  performance: {
    label: '8-Bit',
    dpr: 0.35,
    note: 'Fastest',
    pixelated: true,
    antialias: false,
    shadows: false,
    shadowMapSize: 0,
    civilianDensity: 0.3,
    militaryDensity: 0.55,
    structureDensity: 0.42,
    treeDensity: 0.45,
    birdDensity: 0.25,
    kaijuMax: 2,
    enableSunGlow: false,
    enableRadiationLight: false,
    ashParticles: 3,
    terrainSegments: 64,
    terrainTextureSize: 384,
    terrainPatchCount: 72,
    terrainCrackCount: 20,
    terrainDebrisCount: 160,
    terrainAnisotropy: 1,
    burnMarkCount: 3,
    mushroom: {
      stemCount: 3,
      capCount: 2,
      debrisCount: 8,
      ashCount: 4,
      sparkCount: 8,
      shockRingCount: 4,
      plumeStride: 3,
      particleStride: 4
    }
  },
  balanced: {
    label: '75%',
    dpr: 0.75,
    note: 'Recommended',
    pixelated: false,
    antialias: true,
    shadows: true,
    shadowMapSize: 384,
    civilianDensity: 0.65,
    militaryDensity: 0.8,
    structureDensity: 0.7,
    treeDensity: 0.75,
    birdDensity: 0.5,
    kaijuMax: 3,
    enableSunGlow: true,
    enableRadiationLight: true,
    ashParticles: 5,
    terrainSegments: 72,
    terrainTextureSize: 640,
    terrainPatchCount: 120,
    terrainCrackCount: 28,
    terrainDebrisCount: 240,
    terrainAnisotropy: 4,
    burnMarkCount: 5,
    mushroom: {
      stemCount: 5,
      capCount: 3,
      debrisCount: 12,
      ashCount: 6,
      sparkCount: 12,
      shockRingCount: 5,
      plumeStride: 2,
      particleStride: 3
    }
  },
  high: {
    label: '100%',
    dpr: 1,
    note: 'Sharper',
    pixelated: false,
    antialias: true,
    shadows: true,
    shadowMapSize: 448,
    civilianDensity: 0.82,
    militaryDensity: 0.92,
    structureDensity: 0.85,
    treeDensity: 0.9,
    birdDensity: 0.75,
    kaijuMax: 3,
    enableSunGlow: true,
    enableRadiationLight: true,
    ashParticles: 6,
    terrainSegments: 88,
    terrainTextureSize: 896,
    terrainPatchCount: 160,
    terrainCrackCount: 38,
    terrainDebrisCount: 320,
    terrainAnisotropy: 6,
    burnMarkCount: 7,
    mushroom: {
      stemCount: 5,
      capCount: 3,
      debrisCount: 14,
      ashCount: 8,
      sparkCount: 14,
      shockRingCount: 6,
      plumeStride: 2,
      particleStride: 3
    }
  },
  ultra: {
    label: '125%',
    dpr: 1.25,
    note: 'Crispest',
    pixelated: false,
    antialias: true,
    shadows: true,
    shadowMapSize: 512,
    civilianDensity: 1,
    militaryDensity: 1,
    structureDensity: 1,
    treeDensity: 1,
    birdDensity: 1,
    kaijuMax: 3,
    enableSunGlow: true,
    enableRadiationLight: true,
    ashParticles: 8,
    terrainSegments: 96,
    terrainTextureSize: 1024,
    terrainPatchCount: 200,
    terrainCrackCount: 50,
    terrainDebrisCount: 500,
    terrainAnisotropy: 8,
    burnMarkCount: 8,
    mushroom: {
      stemCount: 5,
      capCount: 3,
      debrisCount: 14,
      ashCount: 8,
      sparkCount: 14,
      shockRingCount: 6,
      plumeStride: 2,
      particleStride: 3
    }
  }
};
const DEFAULT_RESOLUTION_PRESET = 'balanced';
const getInitialResolutionPreset = () => {
  if (typeof window === 'undefined') return DEFAULT_RESOLUTION_PRESET;
  const saved = window.localStorage.getItem('fallout-resolution-preset');
  return saved && RESOLUTION_PRESETS[saved] ? saved : DEFAULT_RESOLUTION_PRESET;
};
const getResolutionProfile = (preset) => RESOLUTION_PRESETS[preset] || RESOLUTION_PRESETS[DEFAULT_RESOLUTION_PRESET];
const getAdaptiveQualityProfile = (baseProfile, stressLevel = 'normal') => {
  if (!baseProfile) return baseProfile;
  if (stressLevel === 'normal') {
    return {
      ...baseProfile,
      detailMode: 'full',
      cityRowsMax: 5,
      treeSmokeStride: 1
    };
  }

  if (stressLevel === 'high') {
    return {
      ...baseProfile,
      shadows: false,
      shadowMapSize: 0,
      enableSunGlow: false,
      enableRadiationLight: false,
      ashParticles: Math.max(0, Math.floor((baseProfile.ashParticles || 0) * 0.5)),
      terrainSegments: Math.max(48, Math.floor((baseProfile.terrainSegments || 72) * 0.72)),
      terrainTextureSize: Math.max(320, Math.floor((baseProfile.terrainTextureSize || 640) * 0.65)),
      burnMarkCount: Math.max(2, Math.floor((baseProfile.burnMarkCount || 4) * 0.6)),
      mushroom: {
        ...baseProfile.mushroom,
        debrisCount: Math.max(6, Math.floor((baseProfile.mushroom?.debrisCount || 10) * 0.65)),
        ashCount: Math.max(3, Math.floor((baseProfile.mushroom?.ashCount || 6) * 0.6)),
        sparkCount: Math.max(6, Math.floor((baseProfile.mushroom?.sparkCount || 10) * 0.65)),
        shockRingCount: Math.max(3, Math.floor((baseProfile.mushroom?.shockRingCount || 5) * 0.7)),
        plumeStride: Math.max(3, (baseProfile.mushroom?.plumeStride || 2) + 1),
        particleStride: Math.max(4, (baseProfile.mushroom?.particleStride || 3) + 1)
      },
      detailMode: 'lean',
      cityRowsMax: 3,
      treeSmokeStride: 2
    };
  }

  return {
    ...baseProfile,
    shadows: false,
    shadowMapSize: 0,
    enableSunGlow: false,
    enableRadiationLight: false,
    ashParticles: 0,
    terrainSegments: Math.max(40, Math.floor((baseProfile.terrainSegments || 64) * 0.58)),
    terrainTextureSize: Math.max(256, Math.floor((baseProfile.terrainTextureSize || 512) * 0.52)),
    burnMarkCount: Math.max(1, Math.floor((baseProfile.burnMarkCount || 3) * 0.4)),
    mushroom: {
      ...baseProfile.mushroom,
      debrisCount: Math.max(4, Math.floor((baseProfile.mushroom?.debrisCount || 8) * 0.45)),
      ashCount: Math.max(2, Math.floor((baseProfile.mushroom?.ashCount || 4) * 0.45)),
      sparkCount: Math.max(4, Math.floor((baseProfile.mushroom?.sparkCount || 8) * 0.45)),
      shockRingCount: Math.max(2, Math.floor((baseProfile.mushroom?.shockRingCount || 4) * 0.5)),
      plumeStride: Math.max(4, (baseProfile.mushroom?.plumeStride || 3) + 1),
      particleStride: Math.max(5, (baseProfile.mushroom?.particleStride || 4) + 1)
    },
    detailMode: 'minimal',
    cityRowsMax: 2,
    treeSmokeStride: 3
  };
};

const AudioManager = {
  ctx: null,
  _cooldowns: {},     // Per-type cooldown timestamps
  _activeCount: 0,    // Total active audio nodes
  _MAX_CONCURRENT: 12, // Hard cap on simultaneous sounds
  _noiseCache: {},    // Cache noise buffers to avoid regeneration
  // Minimum interval (seconds) between plays of the same sound type
  _COOLDOWN_MAP: {
    bomb: 0.3, nuke: 2.0, tank_fire: 0.25, plane_engine: 0.9, plane_flyby: 2.2,
    tank_engine: 1.0, gun: 0.12, scream: 0.8, kaiju_roar: 2.5,
    fire_breath: 1.5, missile_launch: 0.5, target_confirm: 0.15,
    target_blocked: 0.2, bomb_whistle: 1.2, kaiju_step: 0.5
  },
  init() {
    if (!this.ctx && typeof window !== 'undefined') {
       try {
         const AudioContext = window.AudioContext || window.webkitAudioContext;
         this.ctx = new AudioContext();
       } catch(e) {}
    }
    return this.ctx;
  },
  // Cleanup when game ends
  cleanup() {
    if (this.ctx) {
      try { this.ctx.close(); } catch(e) {}
      this.ctx = null;
    }
    this._cooldowns = {};
    this._activeCount = 0;
    this._noiseCache = {};
  },
  // Cached white noise buffer
  getNoiseBuffer(ctx, duration) {
    const key = `white_${Math.round(duration * 10)}`;
    if (!this._noiseCache[key]) {
      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      this._noiseCache[key] = buffer;
    }
    return this._noiseCache[key];
  },
  // Cached pink noise buffer
  getPinkNoise(ctx, duration) {
    const key = `pink_${Math.round(duration * 10)}`;
    if (!this._noiseCache[key]) {
      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750758;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
      this._noiseCache[key] = buffer;
    }
    return this._noiseCache[key];
  },
  play(type, options = {}) {
    const ctx = this.init();
    if (!ctx) return;
    // Resume suspended context (browser autoplay policy)
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch(e) {} }
    const now = performance.now();
    const t = ctx.currentTime;
    
    // --- Rate limiting: per-type cooldown ---
    const cooldown = (this._COOLDOWN_MAP[type] || 0.2) * 1000; // ms
    const lastPlayed = this._cooldowns[type] || 0;
    if (now - lastPlayed < cooldown) return; // Too soon, skip
    
    // --- Global concurrent limit ---
    if (this._activeCount >= this._MAX_CONCURRENT) return;
    
    this._cooldowns[type] = now;
    this._activeCount++;
    
    // Helper: auto-decrement active count after duration
    const scheduleRelease = (dur) => {
      setTimeout(() => { this._activeCount = Math.max(0, this._activeCount - 1); }, dur * 1000);
    };
    
    if (type === 'bomb') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, 1.2);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(300, t);
      lowpass.frequency.exponentialRampToValueAtTime(40, t + 0.8);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.0);
      noise.connect(lowpass).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 1.0);
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(60, t);
      sub.frequency.exponentialRampToValueAtTime(25, t + 0.5);
      subGain.gain.setValueAtTime(0.35, t);
      subGain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
      sub.connect(subGain).connect(ctx.destination);
      sub.start(t); sub.stop(t + 0.5);
      scheduleRelease(1.0);

    } else if (type === 'nuke') {
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(35, t);
      sub.frequency.exponentialRampToValueAtTime(12, t + 3);
      subGain.gain.setValueAtTime(0.5, t);
      subGain.gain.exponentialRampToValueAtTime(0.01, t + 3);
      sub.connect(subGain).connect(ctx.destination);
      sub.start(t); sub.stop(t + 3);
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, 3);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(600, t);
      lowpass.frequency.exponentialRampToValueAtTime(50, t + 2.5);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.4, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 3);
      noise.connect(lowpass).connect(noiseGain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 3);
      scheduleRelease(3);

    } else if (type === 'tank_fire') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, 0.3);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(1500, t);
      lowpass.frequency.exponentialRampToValueAtTime(100, t + 0.25);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
      noise.connect(lowpass).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 0.3);
      scheduleRelease(0.3);

    } else if (type === 'plane_engine') {
      const dur = options.duration || 0.8;
      const vol = options.volume || 0.08;
      const rumble = ctx.createOscillator();
      const turbine = ctx.createOscillator();
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, dur);
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(120, t);
      noiseFilter.frequency.linearRampToValueAtTime(220, t + dur * 0.65);
      noiseFilter.Q.value = 0.6;
      const gain = ctx.createGain();
      const noiseGain = ctx.createGain();
      const wobble = ctx.createOscillator();
      const wobbleGain = ctx.createGain();

      rumble.type = 'sawtooth';
      rumble.frequency.setValueAtTime(62 + Math.random() * 6, t);
      rumble.frequency.linearRampToValueAtTime(54 + Math.random() * 5, t + dur);

      turbine.type = 'triangle';
      turbine.frequency.setValueAtTime(118 + Math.random() * 12, t);
      turbine.frequency.linearRampToValueAtTime(145 + Math.random() * 10, t + dur * 0.6);

      wobble.type = 'sine';
      wobble.frequency.setValueAtTime(5.5 + Math.random() * 1.5, t);
      wobbleGain.gain.setValueAtTime(4, t);

      gain.gain.setValueAtTime(vol, t);
      gain.gain.linearRampToValueAtTime(0.01, t + dur);
      noiseGain.gain.setValueAtTime(vol * 0.38, t);
      noiseGain.gain.linearRampToValueAtTime(0.01, t + dur);

      wobble.connect(wobbleGain);
      wobbleGain.connect(turbine.frequency);
      rumble.connect(gain).connect(ctx.destination);
      turbine.connect(gain);
      noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);

      rumble.start(t); rumble.stop(t + dur);
      turbine.start(t); turbine.stop(t + dur);
      wobble.start(t); wobble.stop(t + dur);
      noise.start(t); noise.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'plane_flyby') {
      const dur = options.duration || 1.7;
      const vol = options.volume || 0.12;
      const rumble = ctx.createOscillator();
      const whine = ctx.createOscillator();
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, dur);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(420, t);
      lowpass.frequency.linearRampToValueAtTime(150, t + dur);
      const gain = ctx.createGain();
      const whineGain = ctx.createGain();
      const noiseGain = ctx.createGain();

      rumble.type = 'sawtooth';
      rumble.frequency.setValueAtTime(82, t);
      rumble.frequency.linearRampToValueAtTime(52, t + dur);

      whine.type = 'triangle';
      whine.frequency.setValueAtTime(180, t);
      whine.frequency.linearRampToValueAtTime(120, t + dur * 0.5);
      whine.frequency.linearRampToValueAtTime(78, t + dur);

      gain.gain.setValueAtTime(vol * 0.4, t);
      gain.gain.linearRampToValueAtTime(vol, t + dur * 0.18);
      gain.gain.linearRampToValueAtTime(0.01, t + dur);

      whineGain.gain.setValueAtTime(vol * 0.16, t);
      whineGain.gain.linearRampToValueAtTime(vol * 0.28, t + dur * 0.22);
      whineGain.gain.linearRampToValueAtTime(0.01, t + dur);

      noiseGain.gain.setValueAtTime(vol * 0.08, t);
      noiseGain.gain.linearRampToValueAtTime(vol * 0.18, t + dur * 0.25);
      noiseGain.gain.linearRampToValueAtTime(0.01, t + dur);

      rumble.connect(gain).connect(ctx.destination);
      whine.connect(whineGain).connect(ctx.destination);
      noise.connect(lowpass).connect(noiseGain).connect(ctx.destination);
      rumble.start(t); rumble.stop(t + dur);
      whine.start(t); whine.stop(t + dur);
      noise.start(t); noise.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'tank_engine') {
      const dur = options.duration || 0.2;
      const vol = options.volume || 0.03;
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, dur);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 200;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, t);
      gain.gain.linearRampToValueAtTime(0.01, t + dur);
      noise.connect(lowpass).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'gun') {
      const profile = options.profile || 'rifleman';
      const vol = options.volume || (profile === 'gunner' ? 0.15 : profile === 'marksman' ? 0.18 : 0.16);
      const dur = profile === 'gunner' ? 0.12 : profile === 'marksman' ? 0.18 : 0.14;

      const crack = ctx.createOscillator();
      const crackGain = ctx.createGain();
      crack.type = 'square';
      crack.frequency.setValueAtTime(profile === 'marksman' ? 1220 : profile === 'gunner' ? 820 : 980, t);
      crack.frequency.exponentialRampToValueAtTime(profile === 'marksman' ? 180 : 130, t + dur * 0.55);
      crackGain.gain.setValueAtTime(vol, t);
      crackGain.gain.exponentialRampToValueAtTime(0.01, t + dur * 0.22);

      const body = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      body.type = 'triangle';
      body.frequency.setValueAtTime(profile === 'marksman' ? 150 : 190, t);
      body.frequency.exponentialRampToValueAtTime(55, t + dur);
      bodyGain.gain.setValueAtTime(vol * 0.3, t);
      bodyGain.gain.exponentialRampToValueAtTime(0.01, t + dur);

      const burst = ctx.createBufferSource();
      burst.buffer = this.getNoiseBuffer(ctx, dur);
      const burstFilter = ctx.createBiquadFilter();
      burstFilter.type = 'bandpass';
      burstFilter.frequency.setValueAtTime(profile === 'marksman' ? 1700 : 1350, t);
      burstFilter.frequency.exponentialRampToValueAtTime(profile === 'gunner' ? 680 : 520, t + dur);
      burstFilter.Q.value = profile === 'marksman' ? 1.8 : 1.2;
      const burstGain = ctx.createGain();
      burstGain.gain.setValueAtTime(vol * 0.46, t);
      burstGain.gain.exponentialRampToValueAtTime(0.01, t + dur);

      const tail = ctx.createBufferSource();
      tail.buffer = this.getPinkNoise(ctx, dur * 1.25);
      const tailFilter = ctx.createBiquadFilter();
      tailFilter.type = 'lowpass';
      tailFilter.frequency.setValueAtTime(profile === 'marksman' ? 620 : 440, t);
      const tailGain = ctx.createGain();
      tailGain.gain.setValueAtTime(vol * (profile === 'marksman' ? 0.16 : 0.1), t + dur * 0.08);
      tailGain.gain.exponentialRampToValueAtTime(0.01, t + dur * 1.2);

      crack.connect(crackGain).connect(ctx.destination);
      body.connect(bodyGain).connect(ctx.destination);
      burst.connect(burstFilter).connect(burstGain).connect(ctx.destination);
      tail.connect(tailFilter).connect(tailGain).connect(ctx.destination);

      crack.start(t); crack.stop(t + dur * 0.28);
      body.start(t); body.stop(t + dur);
      burst.start(t); burst.stop(t + dur);
      tail.start(t); tail.stop(t + dur * 1.2);
      scheduleRelease(dur * 1.2);

    } else if (type === 'scream') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, 0.5);
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.setValueAtTime(900 + Math.random() * 200, t);
      formant.frequency.linearRampToValueAtTime(500, t + 0.5);
      formant.Q.value = 6;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.linearRampToValueAtTime(0.01, t + 0.5);
      noise.connect(formant).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 0.5);
      scheduleRelease(0.5);

    } else if (type === 'kaiju_roar') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, 1.5);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(800, t);
      lowpass.frequency.linearRampToValueAtTime(200, t + 1.5);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.linearRampToValueAtTime(0.01, t + 1.5);
      noise.connect(lowpass).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 1.5);
      const growl = ctx.createOscillator();
      const growlGain = ctx.createGain();
      growl.type = 'sine';
      growl.frequency.setValueAtTime(70, t);
      growl.frequency.linearRampToValueAtTime(35, t + 1.5);
      growlGain.gain.setValueAtTime(0.3, t);
      growlGain.gain.linearRampToValueAtTime(0.01, t + 1.5);
      growl.connect(growlGain).connect(ctx.destination);
      growl.start(t); growl.stop(t + 1.5);
      scheduleRelease(1.5);

    } else if (type === 'fire_breath') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, 0.8);
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(300, t);
      bandpass.frequency.linearRampToValueAtTime(1500, t + 0.3);
      bandpass.frequency.linearRampToValueAtTime(150, t + 0.8);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.linearRampToValueAtTime(0.01, t + 0.8);
      noise.connect(bandpass).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 0.8);
      scheduleRelease(0.8);

    } else if (type === 'missile_launch') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer(ctx, 0.35);
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(200, t);
      bandpass.frequency.exponentialRampToValueAtTime(1500, t + 0.35);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.35);
      noise.connect(bandpass).connect(gain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 0.35);
      scheduleRelease(0.35);
    } else if (type === 'target_confirm') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(620, t);
      osc.frequency.linearRampToValueAtTime(980, t + 0.08);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.12);
      scheduleRelease(0.12);
    } else if (type === 'target_blocked') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(240, t);
      osc.frequency.linearRampToValueAtTime(170, t + 0.14);
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.14);
      scheduleRelease(0.14);
    } else if (type === 'bomb_whistle') {
      const dur = options.duration || 1.45;
      const vol = options.volume || 0.075;
      const osc = ctx.createOscillator();
      const overtone = ctx.createOscillator();
      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer(ctx, dur);
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(1500, t);
      bandpass.frequency.exponentialRampToValueAtTime(420, t + dur);
      bandpass.Q.value = 8;
      const gain = ctx.createGain();
      const overtoneGain = ctx.createGain();
      const noiseGain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1650, t);
      osc.frequency.exponentialRampToValueAtTime(310, t + dur);
      overtone.type = 'sine';
      overtone.frequency.setValueAtTime(2200, t);
      overtone.frequency.exponentialRampToValueAtTime(520, t + dur * 0.9);

      gain.gain.setValueAtTime(vol, t);
      gain.gain.linearRampToValueAtTime(vol * 0.82, t + dur * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.01, t + dur);
      overtoneGain.gain.setValueAtTime(vol * 0.32, t);
      overtoneGain.gain.exponentialRampToValueAtTime(0.01, t + dur * 0.85);
      noiseGain.gain.setValueAtTime(vol * 0.18, t);
      noiseGain.gain.linearRampToValueAtTime(vol * 0.12, t + dur * 0.4);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, t + dur);

      osc.connect(gain).connect(ctx.destination);
      overtone.connect(overtoneGain).connect(ctx.destination);
      noise.connect(bandpass).connect(noiseGain).connect(ctx.destination);
      osc.start(t); osc.stop(t + dur);
      overtone.start(t); overtone.stop(t + dur);
      noise.start(t); noise.stop(t + dur);
      scheduleRelease(dur);
    } else if (type === 'kaiju_step') {
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(52, t);
      sub.frequency.exponentialRampToValueAtTime(28, t + 0.24);
      subGain.gain.setValueAtTime(0.14, t);
      subGain.gain.exponentialRampToValueAtTime(0.01, t + 0.24);
      sub.connect(subGain).connect(ctx.destination);
      sub.start(t); sub.stop(t + 0.24);

      const noise = ctx.createBufferSource();
      noise.buffer = this.getPinkNoise(ctx, 0.24);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(110, t);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.06, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.24);
      noise.connect(lowpass).connect(noiseGain).connect(ctx.destination);
      noise.start(t); noise.stop(t + 0.24);
      scheduleRelease(0.24);
    } else {
      // Unknown type, release immediately
      this._activeCount = Math.max(0, this._activeCount - 1);
    }
  }
};

function createPerson(id, theme) {
  return {
    id, type: 'person', dead: false, state: 'idle',
    x: (Math.random() - 0.5) * WORLD_WIDTH,
    z: (Math.random() - 0.5) * WORLD_DEPTH * 0.8,
    vx: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 1.5,
    fleeVx: 0, fleeVz: 0,
    panicSeed: Math.random() * Math.PI * 2,
    panicBurst: 0.85 + Math.random() * 0.45,
    panicUrgency: 0.7 + Math.random() * 0.5,
    panicDecisionTimer: 0,
    targetBunkerId: null,
    color: theme.personColors[Math.floor(Math.random() * theme.personColors.length)],
    scale: 0.8 + Math.random() * 0.4,
    idleTimer: Math.random() * 100, // Quick initialization
  };
}

function createCar(id, theme) {
  const isRight = Math.random() > 0.5;
  return {
    id, type: 'car', dead: false, state: 'driving',
    x: (Math.random() - 0.5) * WORLD_WIDTH,
    // Scatter cars across significantly wider horizontal bounding fields
    z: (WORLD_DEPTH * 0.4) + (Math.random() - 0.5) * 450,
    vx: (isRight ? 1 : -1) * (theme.carSpeed + Math.random() * 3), vz: 0,
    color: theme.carColors[Math.floor(Math.random() * theme.carColors.length)],
    scale: 1 + Math.random() * 0.5,
    idleTimer: 0,
  };
}

function createSoldierReinforcement(id, bunker, index = 0) {
  const entry = getVaultEntryPoint(bunker);
  const spreadAngle = -Math.PI / 2 + (index - 1.5) * 0.28;
  const spreadRadius = 14 + index * 4;
  const soldier = {
    id,
    type: 'soldier',
    dead: false,
    state: 'walking',
    x: entry.x + Math.cos(spreadAngle) * spreadRadius,
    z: entry.z + Math.sin(spreadAngle) * spreadRadius,
    y: getTerrainHeight(entry.x + Math.cos(spreadAngle) * spreadRadius, entry.z + Math.sin(spreadAngle) * spreadRadius),
    vx: 0,
    vz: 0,
    fleeVx: 0,
    fleeVz: 0,
    panicSeed: Math.random() * Math.PI * 2,
    panicBurst: 0.9 + Math.random() * 0.35,
    panicUrgency: 0.9 + Math.random() * 0.4,
    panicDecisionTimer: 0,
    targetBunkerId: bunker.id,
    color: ['#14532d', '#166534', '#3f6212', '#4d7c0f'][index % 4],
    scale: 0.9 + Math.random() * 0.22,
    idleTimer: 40 + Math.random() * 80,
    deployShieldUntil: Date.now() + DEPLOY_PROTECTION_MS
  };
  return applySoldierLoadout(soldier, index);
}

function createSpecialistSoldier(id, bunker, index = 0, loadoutKey = 'rifleman') {
  const soldier = createSoldierReinforcement(id, bunker, index);
  return applySoldierLoadout(soldier, loadoutKey);
}

function createTankReinforcement(id, bunker, tankConfig = {}) {
  const entry = getVaultEntryPoint(bunker);
  const variant = tankConfig.variant || 'tank';
  const maxHp = tankConfig.maxHp || (variant === 'apc' ? APC_BASE_HP : TANK_BASE_HP);
  return {
    id,
    type: 'tank',
    x: entry.x,
    z: entry.z + 12,
    y: getTerrainHeight(entry.x, entry.z + 12),
    vx: 0,
    vz: 0,
    scale: tankConfig.scale || 1.2,
    state: 'driving',
    variant,
    speedMultiplier: tankConfig.speedMultiplier || 1,
    damageMultiplier: tankConfig.damageMultiplier || 1,
    reloadMultiplier: tankConfig.reloadMultiplier || 1,
    reloadTimer: 0.4 + Math.random() * 1.2,
    hp: maxHp,
    maxHp,
    deployShieldUntil: Date.now() + DEPLOY_PROTECTION_MS,
    dead: false
  };
}

function createBarricadeEntity(id, bunker, target) {
  const clampedTarget = clampStrikeTarget(target);
  const angle = getDeployAngle(bunker, clampedTarget);
  const distFromBunker = Math.max(55, Math.min(180, Math.hypot(clampedTarget.x - bunker.x, clampedTarget.z - bunker.z)));
  const x = bunker.x + Math.cos(angle) * distFromBunker;
  const z = bunker.z + Math.sin(angle) * distFromBunker;
  return {
    id,
    type: 'barricade',
    x,
    z,
    y: getTerrainHeight(x, z),
    rotation: angle,
    hp: BARRICADE_MAX_HP,
    maxHp: BARRICADE_MAX_HP,
    createdAt: Date.now(),
    deployShieldUntil: Date.now() + 2200,
    expiresAt: Date.now() + BARRICADE_LIFETIME_MS,
    dead: false
  };
}

function createFacilityEntity(id, kind, bunker, slotIndex = 0, target = null) {
  const angle = -Math.PI / 2 + slotIndex * (Math.PI / 3);
  const dist = 120 + slotIndex * 18;
  const cx = bunker ? bunker.x : 0;
  const cz = bunker ? bunker.z : 0;
  const x = target?.x ?? (cx + Math.cos(angle) * dist);
  const z = target?.z ?? (cz + Math.sin(angle) * dist);
  const maxHp = kind === 'aa_site' ? 950 : kind === 'radar_tower' ? 900 : kind === 'field_hospital' ? 1050 : 1200;
  const visualScale = kind === 'war_factory'
    ? 2.35
    : kind === 'field_hospital'
    ? 1.95
    : kind === 'tech_lab'
    ? 2.1
    : kind === 'radar_tower'
    ? 1.82
    : kind === 'aa_site'
    ? 1.92
    : 2.08;
  return {
    id,
    type: 'facility',
    kind,
    x,
    z,
    y: getTerrainHeight(x, z),
    rotation: angle + Math.PI / 2,
    hp: maxHp,
    maxHp,
    builtAt: Date.now(),
    turretYaw: 0,
    reloadTimer: 0,
    constructing: false,
    buildProgress: 1,
    buildDuration: FACILITY_BUILD_DURATION,
    buildElapsed: FACILITY_BUILD_DURATION,
    visualScale,
    state: 'online',
    destroyed: false,
    dead: false
  };
}

function createJetReinforcement(id, kaiju) {
  const fromLeft = Math.random() > 0.5;
  return {
    id,
    type: 'jet',
    x: fromLeft ? -WORLD_WIDTH / 2 - 240 : WORLD_WIDTH / 2 + 240,
    y: 240 + Math.random() * 80,
    z: kaiju.z + (Math.random() - 0.5) * 240,
    vx: fromLeft ? 8.5 : -8.5,
    vz: 0,
    targetKaiju: { x: kaiju.x, y: kaiju.y, z: kaiju.z },
    fired: false,
    dead: false
  };
}

const isInForegroundClearZone = (x, z, padding = 0) => (
  z > WORLD_DEPTH * 0.18 - padding &&
  Math.abs(x) < WORLD_WIDTH * 0.2 + padding * 0.5
);

const sampleSpawnPosition = ({
  xRange,
  zRange,
  avoidForeground = false,
  padding = 0,
  attempts = 30
}) => {
  let x = 0;
  let z = 0;

  for (let i = 0; i < attempts; i++) {
    x = (Math.random() - 0.5) * xRange;
    z = (Math.random() - 0.5) * zRange;

    if (!avoidForeground || !isInForegroundClearZone(x, z, padding)) {
      return { x, z };
    }
  }

  return {
    x,
    z: Math.min(z, WORLD_DEPTH * 0.08)
  };
};

function createTree(id, theme) {
  const scale = theme.treeScale * (1 + Math.random() * 1.5);
  const variant = theme.name === 'militarybase'
    ? (Math.random() < 0.7 ? 'pine' : 'broadleaf')
    : (Math.random() < 0.4 ? 'pine' : 'broadleaf');
  const pos = sampleSpawnPosition({
    xRange: WORLD_WIDTH,
    zRange: WORLD_DEPTH,
    avoidForeground: true,
    padding: Math.max(35, scale * 22)
  });

  return {
    id, type: 'tree', dead: false, state: 'idle',
    x: pos.x,
    z: pos.z,
    color: theme.name === 'militarybase' ? '#064e3b' : '#15803d',
    variant,
    trunkColor: theme.name === 'militarybase' ? '#5b3a1a' : '#7c4a22',
    canopyColor: theme.name === 'militarybase' ? '#365314' : '#166534',
    canopyAccent: theme.name === 'militarybase' ? '#4d7c0f' : '#22c55e',
    lean: (Math.random() - 0.5) * 0.12,
    scale,
  };
}

function createHouse(id, theme) {
  const isCityTheme = theme.name === 'city';
  const scale = isCityTheme ? 0.9 + Math.random() * 0.35 : 1 + Math.random() * 0.5;
  const scaleY = isCityTheme
    ? theme.houseScale * (0.42 + Math.random() * 0.48)
    : theme.houseScale * (0.9 + Math.random() * 1.1);
  const styleRoll = Math.random();
  const style = isCityTheme
    ? (styleRoll < 0.22 && scaleY > 1.8 ? 'tower' : styleRoll < 0.62 ? 'gable' : 'hip')
    : (scaleY > 2.2 && styleRoll < 0.38 ? 'tower' : styleRoll < 0.5 ? 'gable' : 'hip');
  const pos = sampleSpawnPosition({
    xRange: WORLD_WIDTH * 0.8,
    zRange: WORLD_DEPTH * 0.6,
    avoidForeground: true,
    padding: Math.max(80, scale * scaleY * 18),
    attempts: 40
  });

  return {
    id, type: 'house', dead: false, state: 'idle',
    x: pos.x,
    z: pos.z,
    color: theme.houseColors[Math.floor(Math.random() * theme.houseColors.length)],
    roofColor: theme.roofColors[Math.floor(Math.random() * theme.roofColors.length)],
    trimColor: theme.name === 'city'
      ? ['#e2e8f0', '#cbd5e1', '#d6d3d1'][Math.floor(Math.random() * 3)]
      : ['#e7e5e4', '#d6d3d1', '#fef3c7'][Math.floor(Math.random() * 3)],
    foundationColor: theme.name === 'city' ? '#475569' : '#7c6f64',
    windowColor: theme.name === 'city'
      ? ['#1e293b', '#334155', '#3f4c63'][Math.floor(Math.random() * 3)]
      : ['#475569', '#52606d', '#334155'][Math.floor(Math.random() * 3)],
    accentColor: theme.name === 'city'
      ? ['#94a3b8', '#64748b', '#cbd5e1'][Math.floor(Math.random() * 3)]
      : ['#b45309', '#92400e', '#a16207'][Math.floor(Math.random() * 3)],
    style,
    doorSide: Math.random() < 0.5 ? -1 : 1,
    roofPitch: 0.52 + Math.random() * 0.1,
    scale,
    // Random height multiplier based on theme
    scaleY,
    rotation: Math.random() * Math.PI,
  };
}

function createBird(id, theme) {
  const isRight = Math.random() > 0.5;
  return {
    id, type: 'bird', dead: false, state: 'flying',
    x: (Math.random() - 0.5) * WORLD_WIDTH,
    y: 80 + Math.random() * 40,
    z: (Math.random() - 0.5) * WORLD_DEPTH,
    vx: (isRight ? 1 : -1) * (2 + Math.random() * 2),
    vy: (Math.random() - 0.5) * 0.5,
    vz: (Math.random() - 0.5) * 1,
    color: '#1e293b',
    scale: 0.5 + Math.random() * 0.5,
    idleTimer: 0,
  };
}

// Realistic Fallout-style Human Character with Physics
const EntityPerson = memo(({ entityId, entityLookupRef, index, entitiesRef }) => {
  const group = useRef();
  const bodyRef = useRef();
  const headRef = useRef();
  const hairRef = useRef();
  const clothRef = useRef();
  const gearRef = useRef();
  const leftLegRef = useRef();
  const rightLegRef = useRef();
  const leftArmRef = useRef();
  const rightArmRef = useRef();
  const repairBeamRef = useRef();
  const repairSparkRef = useRef();
  
  // Physics simulation refs
  const velocity = useRef({ x: 0, y: 0, z: 0 });
  const walkCycle = useRef(0);
  const breathCycle = useRef(0);
  const inertiaDampening = useRef({ x: 0, z: 0 });
  
  // (Optimized: Cloth and hair physics are procedurally simulated via simple Math.sin for performance)
  
  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { 
      if (group.current) group.current.visible = false; 
      return; 
    }
    if (!group.current) return;
    
    const time = Date.now() * 0.001;
    const ds = delta * 60;
    
    // Grounded physics - weight and inertia
    const targetX = p.x;
    const targetZ = p.z;
    const currentX = group.current.position.x;
    const currentZ = group.current.position.z;
    
    // Inertia dampening for heavy, grounded feel
    inertiaDampening.current.x = inertiaDampening.current.x * 0.85 + (targetX - currentX) * 0.15;
    inertiaDampening.current.z = inertiaDampening.current.z * 0.85 + (targetZ - currentZ) * 0.15;
    
    // Apply position with inertia
    group.current.position.x += inertiaDampening.current.x;
    group.current.position.z += inertiaDampening.current.z;
    group.current.position.y = p.y || 0;
    
    // Breathing animation - subtle chest expansion
    breathCycle.current = Math.sin(time * 2) * 0.02;
    if (bodyRef.current) {
      bodyRef.current.scale.x = 1 + breathCycle.current;
      bodyRef.current.scale.z = 1 + breathCycle.current * 0.5;
    }
    
    // Walking/Running animation with weight
    const speed = Math.sqrt((p.vx || 0) ** 2 + (p.vz || 0) ** 2);
    const isMoving = speed > 0.1;
    const isRunning = p.state === 'fleeing';
    const isSoldier = p.type === 'soldier';
    const isAiming = isSoldier && p.state === 'attacking_kaiju';
    const isRepairing = isSoldier && p.weaponType === 'engineer' && p.state === 'repairing';
    
    if (isMoving) {
      // Walk cycle - legs and arms swing
      const walkSpeed = isRunning ? 14 : 6;
      walkCycle.current += speed * walkSpeed * delta;
      
      const swing = Math.sin(walkCycle.current) * (isRunning ? 0.75 : 0.25);
      const armDrive = Math.sin(walkCycle.current + 0.35) * (isRunning ? 0.55 : 0.18);
      
      // Leg animation
      if (leftLegRef.current && rightLegRef.current) {
        leftLegRef.current.rotation.x = swing;
        rightLegRef.current.rotation.x = -swing;
        leftLegRef.current.rotation.z = isRunning ? -0.06 : 0;
        rightLegRef.current.rotation.z = isRunning ? 0.06 : 0;
      }
      
      // Arm counter-swing
      if (leftArmRef.current && rightArmRef.current) {
        if (isRepairing) {
          leftArmRef.current.rotation.x = -1.22;
          rightArmRef.current.rotation.x = -0.88;
          leftArmRef.current.rotation.z = -0.22;
          rightArmRef.current.rotation.z = 0.18;
        } else if (isAiming) {
          leftArmRef.current.rotation.x = -1.15;
          rightArmRef.current.rotation.x = -1.35;
          leftArmRef.current.rotation.z = -0.18;
          rightArmRef.current.rotation.z = 0.08;
        } else {
          leftArmRef.current.rotation.x = -armDrive;
          rightArmRef.current.rotation.x = armDrive;
          leftArmRef.current.rotation.z = isRunning ? -0.12 : 0;
          rightArmRef.current.rotation.z = isRunning ? 0.12 : 0;
        }
      }
      
      // Body bob with weight
      const bob = Math.abs(Math.sin(walkCycle.current * 2)) * (isRunning ? 0.2 : 0.05);
      group.current.position.y += bob;
      
      // Direction facing
      group.current.rotation.y = -Math.atan2(p.vz || 0, p.vx || 1);
      
      // Slight body lean when running
      if (bodyRef.current) {
        bodyRef.current.rotation.x = isAiming ? 0.12 : isRunning ? 0.28 : 0;
        bodyRef.current.rotation.z = isAiming ? 0 : isRunning ? Math.sin(walkCycle.current * 0.5) * 0.04 : 0;
      }
    } else {
      // Idle - subtle weight shift
      const idleSway = Math.sin(time * 0.5) * 0.02;
      if (bodyRef.current) {
        bodyRef.current.rotation.x = 0;
        bodyRef.current.rotation.z = idleSway;
      }
      if (leftArmRef.current && rightArmRef.current) {
        if (isRepairing) {
          leftArmRef.current.rotation.x = -1.22;
          rightArmRef.current.rotation.x = -0.88;
          leftArmRef.current.rotation.z = -0.22;
          rightArmRef.current.rotation.z = 0.18;
        } else if (isAiming) {
          leftArmRef.current.rotation.x = -1.05;
          rightArmRef.current.rotation.x = -1.28;
          leftArmRef.current.rotation.z = -0.18;
          rightArmRef.current.rotation.z = 0.08;
        } else {
          leftArmRef.current.rotation.x = 0;
          rightArmRef.current.rotation.x = 0;
          leftArmRef.current.rotation.z = 0;
          rightArmRef.current.rotation.z = 0;
        }
      }
      if (leftLegRef.current && rightLegRef.current) {
        leftLegRef.current.rotation.x = 0;
        rightLegRef.current.rotation.x = 0;
        leftLegRef.current.rotation.z = 0;
        rightLegRef.current.rotation.z = 0;
      }
      if (isAiming && Number.isFinite(p.aimAngle)) {
        group.current.rotation.set(0, -p.aimAngle, 0);
      } else {
        group.current.rotation.set(0, 0, 0);
      }
    }
    
    // Optimized Math-based physics
    const windForce = Math.sin(time * 1.5) * 0.02;
    const movementForce = isMoving ? speed * 0.1 : 0;
    
    // Apply cloth physics to visual
    if (clothRef.current) {
      const clothSwing = movementForce * Math.sin(walkCycle.current);
      clothRef.current.rotation.x = clothSwing * 0.3;
      clothRef.current.rotation.z = windForce * 2;
    }
    
    // Apply hair physics
    if (hairRef.current) {
      const avgOffset = windForce * 10 + movementForce * Math.sin(walkCycle.current * 1.2) * 2;
      hairRef.current.rotation.z = avgOffset * 0.5;
    }
    
    // Gear swing physics (backpack, belt items)
    if (gearRef.current) {
      const gearSwing = Math.sin(walkCycle.current * 0.8) * (isMoving ? 0.1 : 0.02);
      gearRef.current.rotation.x = gearSwing;
    }
    
    // Head tracking - slight look around
    if (headRef.current) {
      const lookX = Math.sin(time * 0.3) * 0.1;
      const lookY = Math.sin(time * 0.2) * 0.05;
      headRef.current.rotation.y = lookX;
      headRef.current.rotation.x = lookY;
    }
    
    // Fleeing state - panic animation
    if (p.state === 'fleeing') {
      if (bodyRef.current) {
        bodyRef.current.rotation.z += Math.sin(time * 11 + (p.panicSeed || 0)) * 0.08;
      }
      if (headRef.current) {
        headRef.current.rotation.x = -0.16 + Math.sin(time * 7 + (p.panicSeed || 0)) * 0.03;
        headRef.current.rotation.y = Math.sin(time * 5 + (p.panicSeed || 0)) * 0.08;
      }
      if (clothRef.current) {
        clothRef.current.rotation.x += 0.12;
      }
      if (gearRef.current) {
        gearRef.current.rotation.x += Math.sin(walkCycle.current * 1.1) * 0.08;
      }
    } else if (isAiming && bodyRef.current) {
      bodyRef.current.rotation.x += 0.08;
    }

    if (repairBeamRef.current && repairSparkRef.current) {
      const hasRepairTarget = isRepairing && Number.isFinite(p.repairTargetX) && Number.isFinite(p.repairTargetZ);
      repairBeamRef.current.visible = hasRepairTarget;
      repairSparkRef.current.visible = hasRepairTarget;
      if (hasRepairTarget) {
        const localDx = p.repairTargetX - p.x;
        const localDz = p.repairTargetZ - p.z;
        const beamLength = Math.max(6, Math.hypot(localDx, localDz));
        const beamAngle = Math.atan2(localDz, localDx);
        const pulse = 0.82 + Math.sin(time * 18) * 0.18;
        repairBeamRef.current.rotation.z = -beamAngle;
        repairBeamRef.current.scale.set(beamLength / 18, pulse, pulse);
        repairBeamRef.current.position.set(localDx * 0.5, 10.6, localDz * 0.5);
        repairSparkRef.current.position.set(localDx, 10.6, localDz);
        repairSparkRef.current.scale.setScalar(0.85 + pulse * 0.55);
        if (repairBeamRef.current.material) repairBeamRef.current.material.opacity = 0.35 + pulse * 0.22;
        if (repairSparkRef.current.material) repairSparkRef.current.material.opacity = 0.42 + pulse * 0.26;
      }
    }
  });

  const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  if (!p || p.dead) return null;
  
  // Generate character features based on seed
  const seed = p.id.charCodeAt(p.id.length - 1);
  const skinTone = ['#e8beac', '#d4a574', '#c68642', '#8d5524', '#6b4423'][seed % 5];
  const hairColor = ['#1a1a1a', '#3d2314', '#8b4513', '#d4a574', '#c0c0c0', '#8b0000'][seed % 6];
  const clothColor = p.color || '#5c4033';
  const soldierVestColor = p.weaponType === 'marksman' ? '#334155' : p.weaponType === 'gunner' ? '#3f3f46' : p.weaponType === 'engineer' ? '#0f766e' : '#475569';
  const hasBeard = seed % 3 === 0;
  const hasScars = seed % 4 === 0;
  const hasGoggles = seed % 5 === 0;
  const hasMask = seed % 6 === 0;
  const hasBackpack = seed % 3 !== 0;
  const hasArmor = seed % 4 === 1;
  
  return (
    <group ref={group} position={[p.x, 0, p.z]} scale={[p.scale, p.scale, p.scale]}>
      {/* === TORSO / BODY === */}
      <group ref={bodyRef} position={[0, 8, 0]}>
        {/* Main torso - realistic proportions */}
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[2.4, 3.5, 1.4]} />
          <meshStandardMaterial 
            color={clothColor} 
            roughness={0.9}
            metalness={0.1}
          />
        </mesh>
        
        {/* Chest detail - worn fabric texture */}
        <mesh position={[0, 0.3, 0.72]}>
          <boxGeometry args={[2.2, 2, 0.1]} />
          <meshStandardMaterial 
            color={clothColor}
            roughness={1}
            metalness={0}
          />
        </mesh>
        
        {/* Radiation damage / dirt patches */}
        <mesh position={[0.5, -0.5, 0.71]}>
          <circleGeometry args={[0.3, 8]} />
          <meshStandardMaterial 
            color="#2a1f1a"
            roughness={1}
            transparent
            opacity={0.6}
          />
        </mesh>
        
        {/* Torn fabric edges */}
        <mesh position={[-1.1, 0, 0]} rotation={[0, Math.PI/2, 0]}>
          <planeGeometry args={[1.4, 3]} />
          <meshStandardMaterial 
            color={clothColor}
            roughness={1}
            side={THREE.DoubleSide}
          />
        </mesh>
        {p.type === 'soldier' && (
          <>
            <mesh position={[0, 0.15, 0.84]}>
              <boxGeometry args={[2.35, 2.35, 0.38]} />
              <meshStandardMaterial color={soldierVestColor} roughness={0.88} metalness={0.18} />
            </mesh>
            <mesh position={[0, -0.6, 0.88]}>
              <boxGeometry args={[2.1, 0.7, 0.25]} />
              <meshStandardMaterial color="#1f2937" roughness={0.9} metalness={0.08} />
            </mesh>
          </>
        )}
      </group>
      
      {/* === CLOTHING / COAT === */}
      <group ref={clothRef} position={[0, 6, 0]}>
        {/* Long coat tails */}
        <mesh position={[0, -2, 0]}>
          <boxGeometry args={[2.6, 4, 1.2]} />
          <meshStandardMaterial 
            color="#2d1f14"
            roughness={0.95}
          />
        </mesh>
        
        {/* Coat flaps - physics affected */}
        <mesh position={[0.8, -1.5, 0]}>
          <boxGeometry args={[0.8, 3, 0.1]} />
          <meshStandardMaterial 
            color="#2d1f14"
            roughness={0.95}
          />
        </mesh>
        <mesh position={[-0.8, -1.5, 0]}>
          <boxGeometry args={[0.8, 3, 0.1]} />
          <meshStandardMaterial 
            color="#2d1f14"
            roughness={0.95}
          />
        </mesh>
      </group>
      
      {/* === HEAD === */}
      <group ref={headRef} position={[0, 11.5, 0]}>
        {/* Skull - realistic proportions */}
        <mesh>
          <sphereGeometry args={[1.1, 16, 16]} />
          <meshStandardMaterial 
            color={skinTone}
            roughness={0.7}
            metalness={0}
          />
        </mesh>
        
        {/* Face structure - jaw */}
        <mesh position={[0, -0.3, 0.5]}>
          <boxGeometry args={[0.9, 0.6, 0.6]} />
          <meshStandardMaterial 
            color={skinTone}
            roughness={0.7}
          />
        </mesh>
        
        {/* Eyes */}
        <mesh position={[-0.35, 0.1, 0.9]}>
          <sphereGeometry args={[0.15, 8, 8]} />
          <meshStandardMaterial color="#f5f5dc" />
        </mesh>
        <mesh position={[0.35, 0.1, 0.9]}>
          <sphereGeometry args={[0.15, 8, 8]} />
          <meshStandardMaterial color="#f5f5dc" />
        </mesh>
        
        {/* Pupils */}
        <mesh position={[-0.35, 0.1, 1.02]}>
          <sphereGeometry args={[0.08, 6, 6]} />
          <meshBasicMaterial color="#3d2314" />
        </mesh>
        <mesh position={[0.35, 0.1, 1.02]}>
          <sphereGeometry args={[0.08, 6, 6]} />
          <meshBasicMaterial color="#3d2314" />
        </mesh>
        
        {/* Nose */}
        <mesh position={[0, -0.05, 1.05]}>
          <coneGeometry args={[0.15, 0.35, 6]} />
          <meshStandardMaterial 
            color={skinTone}
            roughness={0.7}
          />
        </mesh>
        
        {/* Mouth */}
        <mesh position={[0, -0.45, 0.85]}>
          <boxGeometry args={[0.4, 0.08, 0.1]} />
          <meshStandardMaterial color="#4a3728" />
        </mesh>
        
        {/* Radiation scars */}
        {hasScars && (
          <mesh position={[0.4, 0.2, 0.98]}>
            <planeGeometry args={[0.3, 0.05]} />
            <meshStandardMaterial 
              color="#8b4513"
              roughness={1}
              transparent
              opacity={0.8}
            />
          </mesh>
        )}
        
        {/* Dirt/grime on face */}
        <mesh position={[-0.3, -0.2, 0.95]}>
          <circleGeometry args={[0.2, 6]} />
          <meshStandardMaterial 
            color="#3d2914"
            roughness={1}
            transparent
            opacity={0.4}
          />
        </mesh>
        
        {/* Beard stubble */}
        {hasBeard && (
          <mesh position={[0, -0.5, 0.75]}>
            <sphereGeometry args={[0.5, 8, 8]} />
            <meshStandardMaterial 
              color={hairColor}
              roughness={1}
              transparent
              opacity={0.3}
            />
          </mesh>
        )}
        
        {/* Hair - physics affected */}
        <group ref={hairRef} position={[0, 0.9, -0.1]}>
          <mesh>
            <sphereGeometry args={[1.15, 12, 12]} />
            <meshStandardMaterial 
              color={hairColor}
              roughness={0.9}
            />
          </mesh>
          
          {/* Messy hair strands */}
          {[...Array(6)].map((_, i) => (
            <mesh 
              key={i} 
              position={[
                (Math.random() - 0.5) * 1.5, 
                Math.random() * 0.5, 
                (Math.random() - 0.5) * 1
              ]}
              rotation={[Math.random() * 0.3, Math.random() * Math.PI * 2, 0]}
            >
              <capsuleGeometry args={[0.08, 0.4, 4, 8]} />
              <meshStandardMaterial 
                color={hairColor}
                roughness={0.95}
              />
            </mesh>
          ))}
        </group>
        
        {/* Goggles / eyewear */}
        {hasGoggles && (
          <group position={[0, 0.1, 1]}>
            <mesh position={[-0.35, 0, 0]}>
              <cylinderGeometry args={[0.2, 0.2, 0.15, 12]} />
              <meshStandardMaterial 
                color="#1a1a1a"
                metalness={0.3}
                roughness={0.4}
              />
            </mesh>
            <mesh position={[0.35, 0, 0]}>
              <cylinderGeometry args={[0.2, 0.2, 0.15, 12]} />
              <meshStandardMaterial 
                color="#1a1a1a"
                metalness={0.3}
                roughness={0.4}
              />
            </mesh>
            {/* Strap */}
            <mesh position={[0, 0, -0.5]}>
              <boxGeometry args={[2.2, 0.1, 0.05]} />
              <meshStandardMaterial color="#2a2a2a" />
            </mesh>
          </group>
        )}
        
        {/* Gas mask / respirator */}
        {hasMask && (
          <mesh position={[0, -0.2, 1.1]}>
            <boxGeometry args={[0.8, 0.6, 0.4]} />
            <meshStandardMaterial 
              color="#2a2a2a"
              metalness={0.2}
              roughness={0.6}
            />
          </mesh>
        )}
        {p.type === 'soldier' && (
          <>
            <mesh position={[0, 1.1, -0.05]}>
              <sphereGeometry args={[1.22, 16, 16]} />
              <meshStandardMaterial color="#4b5563" roughness={0.82} metalness={0.18} />
            </mesh>
            <mesh position={[0, 0.88, 0.8]}>
              <boxGeometry args={[1.6, 0.35, 1.1]} />
              <meshStandardMaterial color="#334155" roughness={0.7} metalness={0.24} />
            </mesh>
            {p.weaponType === 'engineer' && (
              <mesh position={[0.95, -0.18, 0.86]} rotation={[0.2, 0, 0.1]}>
                <boxGeometry args={[0.55, 1.7, 0.48]} />
                <meshStandardMaterial color="#f59e0b" roughness={0.72} metalness={0.3} />
              </mesh>
            )}
          </>
        )}
      </group>
      
      {/* === ARMS === */}
      <group ref={leftArmRef} position={[-1.5, 9, 0]}>
        {/* Upper arm */}
        <mesh position={[0, 0.5, 0]}>
          <capsuleGeometry args={[0.35, 1.5, 4, 8]} />
          <meshStandardMaterial 
            color={clothColor}
            roughness={0.9}
          />
        </mesh>
        
        {/* Lower arm */}
        <mesh position={[0, -0.8, 0]}>
          <capsuleGeometry args={[0.3, 1.3, 4, 8]} />
          <meshStandardMaterial 
            color={skinTone}
            roughness={0.7}
          />
        </mesh>
        
        {/* Hand */}
        <mesh position={[0, -1.8, 0]}>
          <boxGeometry args={[0.4, 0.5, 0.25]} />
          <meshStandardMaterial 
            color={skinTone}
            roughness={0.6}
          />
        </mesh>
        
        {/* Wrist wrap / bandage */}
        <mesh position={[0, -1.3, 0]}>
          <cylinderGeometry args={[0.32, 0.32, 0.2, 8]} />
          <meshStandardMaterial color="#8b7355" />
        </mesh>
      </group>
      
      <group ref={rightArmRef} position={[1.5, 9, 0]}>
        <mesh position={[0, 0.5, 0]}>
          <capsuleGeometry args={[0.35, 1.5, 4, 8]} />
          <meshStandardMaterial 
            color={clothColor}
            roughness={0.9}
          />
        </mesh>
        
        <mesh position={[0, -0.8, 0]}>
          <capsuleGeometry args={[0.3, 1.3, 4, 8]} />
          <meshStandardMaterial 
            color={skinTone}
            roughness={0.7}
          />
        </mesh>
        
        <mesh position={[0, -1.8, 0]}>
          <boxGeometry args={[0.4, 0.5, 0.25]} />
          <meshStandardMaterial 
            color={skinTone}
            roughness={0.6}
          />
        </mesh>
        
        {/* Improvised armor / bracer */}
        {hasArmor && (
          <mesh position={[0, -0.8, 0.35]}>
            <boxGeometry args={[0.35, 1, 0.15]} />
            <meshStandardMaterial 
              color="#4a4a4a"
              metalness={0.6}
              roughness={0.4}
            />
          </mesh>
        )}
        {p.type === 'soldier' && (
          <group position={[-0.2, -1.15, 0.35]} rotation={[0.05, p.weaponType === 'marksman' ? 0.18 : 0.06, -Math.PI / 2]}>
            <mesh position={[0, 1.4, 0]}>
              <boxGeometry args={[p.weaponType === 'marksman' ? 3.8 : p.weaponType === 'gunner' ? 2.9 : p.weaponType === 'engineer' ? 2.2 : 3.1, 0.18, 0.24]} />
              <meshStandardMaterial color="#111827" roughness={0.72} metalness={0.22} />
            </mesh>
            <mesh position={[0.65, 0.7, 0]}>
              <boxGeometry args={[0.2, 1.15, 0.22]} />
              <meshStandardMaterial color="#1f2937" roughness={0.75} />
            </mesh>
            <mesh position={[-1.15, 1.46, 0]}>
              <boxGeometry args={[1.3, 0.14, 0.18]} />
              <meshStandardMaterial color="#5b4636" roughness={0.92} />
            </mesh>
            {p.weaponType === 'marksman' && (
              <mesh position={[0.45, 1.65, 0]}>
                <cylinderGeometry args={[0.08, 0.08, 0.9, 8]} />
                <meshStandardMaterial color="#0f172a" metalness={0.35} roughness={0.4} />
              </mesh>
            )}
            {p.weaponType === 'gunner' && (
              <mesh position={[0.55, 0.8, 0]}>
                <boxGeometry args={[0.5, 0.45, 0.34]} />
                <meshStandardMaterial color="#374151" roughness={0.8} />
              </mesh>
            )}
            {p.weaponType === 'engineer' && (
              <mesh position={[0.2, 0.92, 0]}>
                <boxGeometry args={[0.35, 0.9, 0.3]} />
                <meshStandardMaterial color="#f59e0b" roughness={0.78} metalness={0.26} />
              </mesh>
            )}
          </group>
        )}
      </group>

      <mesh ref={repairBeamRef} visible={false} position={[0, 10.6, 0]} renderOrder={4}>
        <boxGeometry args={[18, 0.45, 0.45]} />
        <meshBasicMaterial color="#5eead4" transparent opacity={0.45} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={repairSparkRef} visible={false} position={[0, 10.6, 0]} renderOrder={5}>
        <sphereGeometry args={[0.9, 8, 8]} />
        <meshBasicMaterial color="#facc15" transparent opacity={0.7} depthWrite={false} toneMapped={false} />
      </mesh>
      
      {/* === LEGS === */}
      <group ref={leftLegRef} position={[-0.6, 4.5, 0]}>
        {/* Thigh */}
        <mesh position={[0, 1, 0]}>
          <capsuleGeometry args={[0.45, 1.8, 4, 8]} />
          <meshStandardMaterial 
            color="#3d2914"
            roughness={0.9}
          />
        </mesh>
        
        {/* Calf */}
        <mesh position={[0, -0.8, 0]}>
          <capsuleGeometry args={[0.4, 1.6, 4, 8]} />
          <meshStandardMaterial 
            color="#3d2914"
            roughness={0.9}
          />
        </mesh>
        
        {/* Boot */}
        <mesh position={[0, -2, 0.15]}>
          <boxGeometry args={[0.6, 0.6, 1]} />
          <meshStandardMaterial 
            color="#1a1a1a"
            roughness={0.8}
          />
        </mesh>
        
        {/* Knee pad */}
        <mesh position={[0, 0.2, 0.45]}>
          <boxGeometry args={[0.5, 0.4, 0.15]} />
          <meshStandardMaterial 
            color="#2a2a2a"
            roughness={0.7}
          />
        </mesh>
      </group>
      
      <group ref={rightLegRef} position={[0.6, 4.5, 0]}>
        <mesh position={[0, 1, 0]}>
          <capsuleGeometry args={[0.45, 1.8, 4, 8]} />
          <meshStandardMaterial 
            color="#3d2914"
            roughness={0.9}
          />
        </mesh>
        
        <mesh position={[0, -0.8, 0]}>
          <capsuleGeometry args={[0.4, 1.6, 4, 8]} />
          <meshStandardMaterial 
            color="#3d2914"
            roughness={0.9}
          />
        </mesh>
        
        <mesh position={[0, -2, 0.15]}>
          <boxGeometry args={[0.6, 0.6, 1]} />
          <meshStandardMaterial 
            color="#1a1a1a"
            roughness={0.8}
          />
        </mesh>
      </group>
      
      {/* === GEAR / EQUIPMENT === */}
      <group ref={gearRef} position={[0, 9, 0]}>
        {/* Backpack */}
        {hasBackpack && (
          <mesh position={[0, 0, -0.9]}>
            <boxGeometry args={[1.4, 2.2, 0.8]} />
            <meshStandardMaterial 
              color="#4a3728"
              roughness={0.95}
            />
          </mesh>
        )}
        
        {/* Belt */}
        <mesh position={[0, -1, 0]}>
          <torusGeometry args={[0.7, 0.1, 8, 16]} />
          <meshStandardMaterial 
            color="#2a1f14"
            roughness={0.8}
          />
        </mesh>
        
        {/* Belt pouches */}
        <mesh position={[-0.7, -1, 0.3]}>
          <boxGeometry args={[0.4, 0.5, 0.25]} />
          <meshStandardMaterial color="#3d2914" />
        </mesh>
        <mesh position={[0.7, -1, 0.3]}>
          <boxGeometry args={[0.4, 0.5, 0.25]} />
          <meshStandardMaterial color="#3d2914" />
        </mesh>
        
        {/* Shoulder strap */}
        <mesh position={[0.9, 1, 0]} rotation={[0, 0, 0.3]}>
          <boxGeometry args={[0.15, 3, 0.05]} />
          <meshStandardMaterial color="#2a1f14" />
        </mesh>
        
        {/* Canteen */}
        <mesh position={[0.85, -0.5, 0.4]}>
          <cylinderGeometry args={[0.15, 0.12, 0.5, 8]} />
          <meshStandardMaterial 
            color="#556b2f"
            metalness={0.1}
            roughness={0.7}
          />
        </mesh>
      </group>
      
      {/* === IMPROVISED ARMOR === */}
      {hasArmor && (
        <group position={[0, 8.5, 0]}>
          {/* Chest plate - scrap metal */}
          <mesh position={[0, 0.5, 0.75]}>
            <boxGeometry args={[2, 1.5, 0.15]} />
            <meshStandardMaterial 
              color="#5a5a5a"
              metalness={0.7}
              roughness={0.3}
            />
          </mesh>
          
          {/* Rust patches */}
          <mesh position={[0.3, 0.3, 0.83]}>
            <circleGeometry args={[0.25, 8]} />
            <meshStandardMaterial 
              color="#8b4513"
              roughness={1}
              transparent
              opacity={0.6}
            />
          </mesh>
          
          {/* Shoulder pads */}
          <mesh position={[-1.3, 1, 0]}>
            <boxGeometry args={[0.6, 0.4, 0.5]} />
            <meshStandardMaterial 
              color="#4a4a4a"
              metalness={0.5}
              roughness={0.4}
            />
          </mesh>
          <mesh position={[1.3, 1, 0]}>
            <boxGeometry args={[0.6, 0.4, 0.5]} />
            <meshStandardMaterial 
              color="#4a4a4a"
              metalness={0.5}
              roughness={0.4}
            />
          </mesh>
        </group>
      )}
      
      {/* === DUST PARTICLES (footsteps) === */}
      {(p.vx || p.vz) && Math.random() < 0.1 && (
        <mesh position={[
          group.current?.position.x || p.x,
          0.1,
          group.current?.position.z || p.z
        ]}>
          <sphereGeometry args={[0.3, 4, 4]} />
          <meshBasicMaterial 
            color="#8b7355"
            transparent
            opacity={0.3}
          />
        </mesh>
      )}
    </group>
  );
});

const EntityCar = memo(({ index, entitiesRef }) => {
  const group = useRef();
  const intact = useRef();
  const broken = useRef();
  const smokeMeshes = useRef([]);
  const wreckTilt = useRef((Math.random() - 0.5) * 0.35);
  
  useFrame((state) => {
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    if (!group.current) return;
    
    group.current.position.set(p.x, 8 * p.scale + (p.y || 0), p.z);
    const isBroken = p.state === 'broken' || p.state === 'ruined';

    if (intact.current) intact.current.visible = !isBroken;
    if (broken.current) broken.current.visible = isBroken;
    
    if (isBroken) {
       group.current.rotation.set(0.2, p.vx > 0 ? Math.PI / 2 : -Math.PI / 2, wreckTilt.current);
       smokeMeshes.current.forEach((sm, i) => {
          if (!sm) return;
          sm.visible = true;
          const t = (Date.now() * 0.0012 + i * 0.9) % 2.8;
          sm.position.y = 4 + t * 7;
          sm.scale.setScalar(0.5 + t * 0.55);
          if (sm.material) sm.material.opacity = Math.max(0, 0.42 - t * 0.12);
       });
    } else if (p.state === 'fleeing') {
       // Cars flip sideways chaotically
       group.current.rotation.x += 0.1;
       group.current.rotation.z += 0.2;
    } else {
       group.current.rotation.set(0, p.vx > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    }
  });

  const p = entitiesRef.current[index];
  if (!p || p.dead) return null;
  return (
    <group ref={group} position={[p.x, 8 * p.scale, p.z]}>
      <group ref={intact}>
        <mesh>
          <boxGeometry args={[12 * p.scale, 6 * p.scale, 24 * p.scale]} />
          <meshLambertMaterial color={p.color} />
        </mesh>
        <mesh position={[0, 5 * p.scale, -2 * p.scale]}>
          <boxGeometry args={[10 * p.scale, 4 * p.scale, 12 * p.scale]} />
          <meshLambertMaterial color="#000" />
        </mesh>
      </group>
      <group ref={broken} visible={false}>
        <mesh position={[0, -1 * p.scale, 0]} rotation={[0.18, 0.15, -0.1]} scale={[1.05, 0.55, 1.1]}>
          <boxGeometry args={[12 * p.scale, 6 * p.scale, 24 * p.scale]} />
          <meshLambertMaterial color="#3f1d1d" />
        </mesh>
        <mesh position={[1 * p.scale, 3 * p.scale, -3 * p.scale]} rotation={[0.4, 0.3, 0.35]} scale={[0.9, 0.45, 0.9]}>
          <boxGeometry args={[10 * p.scale, 4 * p.scale, 12 * p.scale]} />
          <meshLambertMaterial color="#111111" />
        </mesh>
        <mesh position={[-4 * p.scale, -3.5 * p.scale, 6 * p.scale]} rotation={[0.2, 0, 1.2]}>
          <cylinderGeometry args={[1.2 * p.scale, 1.2 * p.scale, 2 * p.scale, 10]} />
          <meshLambertMaterial color="#0f172a" />
        </mesh>
        {[0, 1, 2].map((i) => (
          <mesh
            key={`car-smoke-${i}`}
            visible={false}
            ref={el => { if (el) smokeMeshes.current.push(el); }}
            position={[(Math.random() - 0.5) * 4, 4, (Math.random() - 0.5) * 3]}
          >
            <sphereGeometry args={[1.8 + Math.random() * 0.8, 8, 8]} />
            <meshBasicMaterial color="#2f2f2f" transparent opacity={0.35} />
          </mesh>
        ))}
      </group>
    </group>
  );
});

const EntityTank = memo(({ entityId, entityLookupRef, index, entitiesRef }) => {
  const group = useRef();
  const turret = useRef();
  const fireAnim = useRef(0);
  const soundCooldown = useRef(0);
  const turretAngle = useRef(0);
  const hullMats = useRef([]);
  const smokeMeshes = useRef([]);
  const wasBroken = useRef(false);
  
  useFrame((state, delta) => {
    // Force render update
    
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { 
      if (group.current) group.current.visible = false; 
      return; 
    }
    if (!group.current) return;
    
    // Update cooldowns using refs (no re-renders)
    soundCooldown.current = Math.max(0, soundCooldown.current - delta);
    fireAnim.current = Math.max(0, fireAnim.current - delta * 5);
    
    // Tanks can still fire when broken (props) - check for broken state
    const isBroken = p.state === 'broken';
    
    // === BROKEN VISUAL: darken hull + show smoke ===
    if (isBroken && !wasBroken.current) {
        wasBroken.current = true;
        hullMats.current.forEach(mat => {
            if (mat) { mat.color.set('#1a1a1a'); mat.emissive && mat.emissive.set('#331100'); mat.emissiveIntensity = 0.3; }
        });
        // Tilt slightly like damaged
        if (group.current) group.current.rotation.z = (Math.random() - 0.5) * 0.15;
    }
    // Animate smoke particles rising from broken tank
    if (isBroken) {
        smokeMeshes.current.forEach((sm, i) => {
            if (!sm) return;
            sm.visible = true;
            const t = (Date.now() * 0.001 + i * 1.3) % 3; // Loop every 3 seconds per particle
            sm.position.y = 5 + t * 12;
            sm.scale.setScalar(0.5 + t * 0.8);
            if (sm.material) sm.material.opacity = Math.max(0, 0.6 - t * 0.2);
        });
    }

    let followingCommand = false;
    if (!isBroken && p.commandTargetX !== undefined && p.commandTargetZ !== undefined) {
      const cmdDx = p.commandTargetX - p.x;
      const cmdDz = p.commandTargetZ - p.z;
      const cmdDist = Math.sqrt(cmdDx * cmdDx + cmdDz * cmdDz);
      if (cmdDist > 18) {
        const cmdAngle = Math.atan2(cmdDz, cmdDx);
        p.vx = Math.cos(cmdAngle) * 3.3;
        p.vz = Math.sin(cmdAngle) * 3.3;
        p.state = 'driving';
        turretAngle.current = -cmdAngle + Math.PI;
        followingCommand = true;
      } else {
        p.commandTargetX = undefined;
        p.commandTargetZ = undefined;
      }
    }
    
    let nearestKaiju = null;
    let minDist = Infinity;
    if (!followingCommand) {
      entitiesRef.current.forEach(k => {
          if (k.type === 'kaiju' && !isKaijuDefeated(k) && !isFlyingKaijuVariant(k.variant)) {
             const kd = Math.sqrt(Math.pow(k.x - p.x, 2) + Math.pow(k.z - p.z, 2));
             if (kd < minDist) { minDist = kd; nearestKaiju = k; }
          }
      });
    }
    
    if (nearestKaiju) {
        // UNIQUE COMBAT POSITIONING: Prevent tanks from clumping up
        p.targetDist = p.targetDist || (150 + Math.random() * 150); // 150 to 300 unit engagement range
        p.orbitOffset = p.orbitOffset || ((Math.random() - 0.5) * 1.5); // Spread tanks out
        
        let angleToKaiju = Math.atan2(nearestKaiju.z - p.z, nearestKaiju.x - p.x);
        turretAngle.current = -angleToKaiju + Math.PI;
        
        // KITE AI: Maintain optimal distance
        if (!isBroken && minDist < p.targetDist - 40) {
           const revSpeed = 1.0;
           p.vx = -Math.cos(angleToKaiju + p.orbitOffset) * revSpeed;
           p.vz = -Math.sin(angleToKaiju + p.orbitOffset) * revSpeed;
        } else if (!isBroken && minDist > p.targetDist + 40) {
           const speed = 2.5;
           p.vx = Math.cos(angleToKaiju + p.orbitOffset) * speed;
           p.vz = Math.sin(angleToKaiju + p.orbitOffset) * speed;
           p.state = 'driving';
        } else {
           p.vx = 0; p.vz = 0; // Hold position
        }
        
        // REALISTIC RELOAD MECHANICS — broken tanks fire slower
        p.reloadTimer = Math.max(0, (p.reloadTimer || 0) - delta);
        const reloadScale = Math.max(0.2, p.reloadMultiplier || 1);
        const reloadTime = (isBroken ? 3.0 + Math.random() * 2.0 : 1.5 + Math.random() * 1.0) / reloadScale;
        
        if (!isBroken && p.reloadTimer <= 0 && minDist < p.targetDist + 80) { 
            p.reloadTimer = reloadTime;
            AudioManager.play('tank_fire');
            nearestKaiju.hp -= TANK_SHELL_DAMAGE * Math.max(0.8, p.damageMultiplier || 1);
            if (nearestKaiju.hp <= 0) markKaijuDefeated(nearestKaiju);
            
            // Spawn tank shell effect from turret tip
            const turretTipX = p.x + Math.cos(angleToKaiju) * 15;
            const turretTipZ = p.z + Math.sin(angleToKaiju) * 15;
            entitiesRef.current.push({
                id: `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                type: 'shell',
                x: turretTipX, y: 15, z: turretTipZ,
                targetX: nearestKaiju.x, targetY: nearestKaiju.y + 40, targetZ: nearestKaiju.z,
                age: 0, dead: false
            });
            // Spawn muzzle flash
            entitiesRef.current.push({
                id: `muzzleflash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                type: 'muzzle_flash',
                x: turretTipX, y: 15, z: turretTipZ,
                age: 0, dead: false
            });
            // Trigger powerful recoil animation
            fireAnim.current = 1;
        }
        
        // Tank engine rumble - only play when moving
        if ((Math.abs(p.vx) > 0 || Math.abs(p.vz) > 0) && soundCooldown.current <= 0 && Math.random() < 0.05) {
           AudioManager.play('tank_engine', { volume: 0.04, duration: 0.2 });
           soundCooldown.current = 0.6;
        }
    } else {
        // Slow down and stop if nothing to attack
        p.vx *= 0.95;
        p.vz *= 0.95;
    }
    
    // Apply movement
    if (!isBroken && (p.vx || p.vz)) {
        p.x += p.vx;
        p.z += p.vz;
        // Rotate body to face movement direction
        group.current.rotation.y = Math.atan2(p.vz, p.vx);
    }
    
    group.current.position.set(p.x, 8 * p.scale, p.z);
    
    // Turret rotation and recoil animation
    if (turret.current) {
        turret.current.rotation.y = turretAngle.current;
        turret.current.position.z = fireAnim.current * -3; // Recoil back
        turret.current.position.y = 2 + fireAnim.current * 1; // Slight jump up
        // Drooping turret on broken tank
        if (isBroken) turret.current.rotation.x = 0.15;
    }
  });

  const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  if (!p || p.dead) return null;
  const hullColor = p.variant === 'apc' ? '#1d4ed8' : '#166534';
  const turretColor = p.variant === 'apc' ? '#1e40af' : '#14532d';
  return (
    <group ref={group} position={[p.x, 8 * p.scale, p.z]} scale={[p.scale, p.scale, p.scale]}>
       {/* Hull */}
       <mesh position={[0, -2, 0]}>
          <boxGeometry args={[16, 6, 10]} />
          <meshStandardMaterial ref={el => { if(el) hullMats.current.push(el); }} color={hullColor} />
       </mesh>
       {/* Treads */}
       <mesh position={[0, -5, 5]}>
          <boxGeometry args={[20, 3, 3]} />
          <meshStandardMaterial ref={el => { if(el) hullMats.current.push(el); }} color="#171717" />
       </mesh>
       <mesh position={[0, -5, -5]}>
          <boxGeometry args={[20, 3, 3]} />
          <meshStandardMaterial ref={el => { if(el) hullMats.current.push(el); }} color="#171717" />
       </mesh>
       {/* Turret */}
       <group ref={turret} position={[0, 2, 0]}>
          <mesh position={[0, 0, 0]}>
             <cylinderGeometry args={[4, 4, 3, 32]} />
             <meshStandardMaterial ref={el => { if(el) hullMats.current.push(el); }} color={turretColor} />
          </mesh>
          <mesh position={[10, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
             <cylinderGeometry args={[0.8, 0.8, 16, 16]} />
             <meshStandardMaterial ref={el => { if(el) hullMats.current.push(el); }} color="#171717" />
          </mesh>
       </group>
       {/* Smoke particles (hidden until broken) */}
       {[0, 1, 2, 3].map(i => (
          <mesh key={`smoke-${i}`} visible={false} ref={el => { if(el) smokeMeshes.current.push(el); }} position={[(Math.random()-0.5)*6, 5, (Math.random()-0.5)*4]}>
             <sphereGeometry args={[2 + Math.random(), 8, 8]} />
             <meshBasicMaterial color="#222222" transparent opacity={0.5} />
          </mesh>
       ))}
    </group>
  );
});

const EntityBird = memo(({ index, entitiesRef }) => {
  const group = useRef();
  
  useFrame((state) => {
    const p = entitiesRef.current[index];
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    if (!group.current) return;
    group.current.position.set(p.x, p.y, p.z);
    group.current.rotation.y = p.vx > 0 ? Math.PI / 2 : -Math.PI / 2;
  });

  const p = entitiesRef.current[index];
  if (!p || p.dead) return null;
  return (
    <group ref={group} position={[p.x, p.y, p.z]}>
      <mesh>
        <boxGeometry args={[2 * p.scale, 2 * p.scale, 6 * p.scale]} />
        <meshLambertMaterial color={p.color} />
      </mesh>
    </group>
  );
});

const EntityHouse = memo(({ index, entitiesRef }) => {
  const group = useRef();
  const intact = useRef();
  const broken = useRef();
  const ruined = useRef();
  const smokeMeshes = useRef([]);
  const collapseProgress = useRef(0);
  const fallDir = useRef(Math.random() * Math.PI * 2);
  const [assetReady, setAssetReady] = useState(Boolean(worldPropsAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(worldPropsAssetCache.error));
  const entity = entitiesRef.current[index];
  const isTower = entity?.style === 'tower' || (entity?.scaleY || 1) > 2;

  const intactModel = useMemo(() => {
    if (!assetReady || !worldPropsAssetCache.scene || !entity) return null;
    const clone = cloneNamedGlbGroup(worldPropsAssetCache.scene, isTower ? 'house_tower' : 'house_residential');
    tintPropClone(
      clone,
      {
        house_foundation: entity.foundationColor || '#7c6f64',
        house_body: entity.color || '#e8d6b2',
        house_trim: entity.trimColor || '#d6d3d1',
        house_roof: entity.roofColor || '#8b4513',
        house_window: entity.windowColor || '#475569',
        house_accent: entity.accentColor || '#94a3b8',
        house_door: '#4b2e1f',
        house_chimney: '#8b5e34'
      },
      { house_window: 0.16 }
    );
    return clone;
  }, [
    assetReady,
    entity?.foundationColor,
    entity?.color,
    entity?.trimColor,
    entity?.roofColor,
    entity?.windowColor,
    entity?.accentColor,
    isTower
  ]);

  const brokenModel = useMemo(() => {
    if (!assetReady || !worldPropsAssetCache.scene || !entity) return null;
    const clone = cloneNamedGlbGroup(worldPropsAssetCache.scene, 'house_broken');
    tintPropClone(clone, {
      house_wreck_base: '#3b2213',
      house_wreck_roof: entity.roofColor || '#8b4513',
      house_wreck_body: '#4b2d18',
      house_wreck_beam: '#1c1917'
    });
    return clone;
  }, [assetReady, entity?.roofColor]);

  const ruinedModel = useMemo(() => {
    if (!assetReady || !worldPropsAssetCache.scene || !entity) return null;
    const clone = cloneNamedGlbGroup(worldPropsAssetCache.scene, 'house_ruined');
    tintPropClone(clone, {
      house_wreck_base: '#24140b',
      house_wreck_roof: entity.roofColor || '#8b4513',
      house_wreck_body: '#402211',
      house_wreck_beam: '#1c1917'
    });
    return clone;
  }, [assetReady, entity?.roofColor]);

  useEffect(() => {
    let cancelled = false;
    if (!assetReady && !assetFailed) {
      loadWorldPropsAsset()
        .then(() => {
          if (!cancelled) setAssetReady(true);
        })
        .catch(() => {
          if (!cancelled) setAssetFailed(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [assetReady, assetFailed]);

  useEffect(() => () => disposeClonedMaterials(intactModel), [intactModel]);
  useEffect(() => () => disposeClonedMaterials(brokenModel), [brokenModel]);
  useEffect(() => () => disposeClonedMaterials(ruinedModel), [ruinedModel]);

  useFrame((_, delta) => {
    const p = entitiesRef.current[index];
    if (!p || p.dead) {
      if (group.current) group.current.visible = false;
      return;
    }
    if (!group.current) return;
    const isBrokenState = p.state === 'broken' || p.state === 'ruined';
    const isRuinedState = p.state === 'ruined';

    group.current.visible = true;
    group.current.position.x = p.x;
    group.current.position.z = p.z;
    group.current.rotation.y = p.rotation || 0;

    if (isBrokenState) {
      if (collapseProgress.current < 1) {
        collapseProgress.current += delta * 1.5;
        const tilt = Math.min(Math.PI / 2.2, collapseProgress.current * (Math.PI / 2));
        group.current.rotation.x = -Math.cos(fallDir.current) * tilt;
        group.current.rotation.z = Math.sin(fallDir.current) * tilt;
        group.current.position.y = -collapseProgress.current * (isRuinedState ? 14 : 10);

        if (collapseProgress.current > 0.72) {
          if (intact.current) intact.current.visible = false;
          if (broken.current) broken.current.visible = !isRuinedState;
          if (ruined.current) ruined.current.visible = isRuinedState;
        }
      } else {
        if (intact.current) intact.current.visible = false;
        if (broken.current) broken.current.visible = !isRuinedState;
        if (ruined.current) ruined.current.visible = isRuinedState;
      }

      smokeMeshes.current.forEach((sm, i) => {
        if (!sm) return;
        sm.visible = true;
        const t = (Date.now() * 0.0009 + i * 0.8) % 3.4;
        sm.position.y = sm.userData.baseY + t * 6;
        sm.scale.setScalar(sm.userData.baseScale + t * 0.35);
        if (sm.material) sm.material.opacity = Math.max(0, 0.36 - t * 0.08);
      });
    } else {
      if (intact.current) intact.current.visible = true;
      if (broken.current) broken.current.visible = false;
      if (ruined.current) ruined.current.visible = false;
      group.current.rotation.set(0, p.rotation || 0, 0);
      group.current.position.y = 0;
      collapseProgress.current = 0;
      smokeMeshes.current.forEach((sm) => {
        if (sm) sm.visible = false;
      });
    }
  });

  if (!entity || entity.dead) return null;

  return (
    <group ref={group} position={[entity.x, 0, entity.z]}>
      <group ref={intact} scale={[entity.scale, entity.scale * (entity.scaleY || 1), entity.scale]}>
        {intactModel ? (
          <primitive object={intactModel} />
        ) : (
          <>
            <mesh position={[0, 19, 0]}>
              <boxGeometry args={[28, 30, 28]} />
              <meshStandardMaterial color={entity.color} roughness={0.82} />
            </mesh>
            <mesh position={[0, 37, 0]}>
              <boxGeometry args={[30, 4, 18]} />
              <meshStandardMaterial color={entity.roofColor} roughness={0.84} />
            </mesh>
          </>
        )}
      </group>

      <group ref={broken} visible={false} scale={[entity.scale, entity.scale, entity.scale]}>
        {brokenModel ? (
          <primitive object={brokenModel} />
        ) : (
          <mesh position={[0, 4, 0]}>
            <boxGeometry args={[36, 9, 36]} />
            <meshStandardMaterial color="#3b2213" roughness={0.96} />
          </mesh>
        )}
        {[0, 1].map((i) => (
          <mesh
            key={`broken-house-smoke-${i}`}
            visible={false}
            ref={(el) => {
              smokeMeshes.current[i] = el;
              if (el) {
                el.userData.baseY = 10 + i * 4;
                el.userData.baseScale = 1.1 + i * 0.2;
              }
            }}
            position={[(i === 0 ? -6 : 8), 10 + i * 4, (i === 0 ? 5 : -4)]}
          >
            <sphereGeometry args={[3 + i, 8, 8]} />
            <meshBasicMaterial color="#2f2f2f" transparent opacity={0.3} />
          </mesh>
        ))}
      </group>

      <group ref={ruined} visible={false} scale={[entity.scale, entity.scale, entity.scale]}>
        {ruinedModel ? (
          <primitive object={ruinedModel} />
        ) : (
          <mesh position={[0, 2, 0]}>
            <boxGeometry args={[38, 6, 38]} />
            <meshStandardMaterial color="#24140b" roughness={0.98} />
          </mesh>
        )}
        {[0, 1, 2].map((i) => (
          <mesh
            key={`ruined-house-smoke-${i}`}
            visible={false}
            ref={(el) => {
              smokeMeshes.current[2 + i] = el;
              if (el) {
                el.userData.baseY = 8 + i * 4;
                el.userData.baseScale = 1.2 + i * 0.3;
              }
            }}
            position={[(i - 1) * 7, 8 + i * 4, (i % 2 === 0 ? -5 : 7)]}
          >
            <sphereGeometry args={[3.5 + i * 0.6, 8, 8]} />
            <meshBasicMaterial color="#2a2a2a" transparent opacity={0.34} />
          </mesh>
        ))}
      </group>
    </group>
  );
});

const EntityTree = memo(({ index, entitiesRef }) => {
  const intact = useRef();
  const broken = useRef();
  const smokeMeshes = useRef([]);
  const frameSkip = useRef(0);
  const [assetReady, setAssetReady] = useState(Boolean(worldPropsAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(worldPropsAssetCache.error));
  const entity = entitiesRef.current[index];
  const isPine = entity?.variant === 'pine';

  const intactModel = useMemo(() => {
    if (!assetReady || !worldPropsAssetCache.scene || !entity) return null;
    const clone = cloneNamedGlbGroup(worldPropsAssetCache.scene, isPine ? 'tree_pine' : 'tree_broadleaf');
    tintPropClone(clone, {
      tree_trunk: entity.trunkColor || '#7c4a22',
      tree_root: '#4b2e16',
      tree_branch: entity.trunkColor || '#7c4a22',
      tree_canopy: entity.canopyColor || entity.color || '#166534',
      tree_canopy_accent: entity.canopyAccent || entity.color || '#22c55e'
    });
    return clone;
  }, [assetReady, isPine, entity?.trunkColor, entity?.canopyColor, entity?.canopyAccent, entity?.color]);

  const brokenModel = useMemo(() => {
    if (!assetReady || !worldPropsAssetCache.scene || !entity) return null;
    const clone = cloneNamedGlbGroup(worldPropsAssetCache.scene, isPine ? 'tree_broken_pine' : 'tree_broken_broadleaf');
    tintPropClone(clone, {
      tree_trunk: '#45210b',
      tree_fallen_trunk: '#5b2d0f',
      tree_canopy: entity.canopyColor || entity.color || '#166534',
      tree_canopy_accent: entity.canopyAccent || entity.color || '#22c55e'
    });
    return clone;
  }, [assetReady, isPine, entity?.canopyColor, entity?.canopyAccent, entity?.color]);

  useEffect(() => {
    let cancelled = false;
    if (!assetReady && !assetFailed) {
      loadWorldPropsAsset()
        .then(() => {
          if (!cancelled) setAssetReady(true);
        })
        .catch(() => {
          if (!cancelled) setAssetFailed(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [assetReady, assetFailed]);

  useEffect(() => () => disposeClonedMaterials(intactModel), [intactModel]);
  useEffect(() => () => disposeClonedMaterials(brokenModel), [brokenModel]);

  useFrame(() => {
    const p = entitiesRef.current[index];
    if (!p || p.dead) {
      if (intact.current) intact.current.visible = false;
      if (broken.current) broken.current.visible = false;
      return;
    }
    const isBrokenState = p.state === 'broken' || p.state === 'ruined';
    if (isBrokenState) {
      if (intact.current) intact.current.visible = false;
      if (broken.current) broken.current.visible = true;
      frameSkip.current = (frameSkip.current + 1) % 2;
      if (frameSkip.current !== 0) return;
      smokeMeshes.current.forEach((sm, i) => {
        if (!sm) return;
        sm.visible = true;
        const t = (Date.now() * 0.001 + i * 0.6) % 2.8;
        sm.position.y = sm.userData.baseY + t * 4;
        sm.scale.setScalar(sm.userData.baseScale + t * 0.25);
        if (sm.material) sm.material.opacity = Math.max(0, 0.32 - t * 0.09);
      });
    } else {
      if (intact.current) intact.current.visible = true;
      if (broken.current) broken.current.visible = false;
      smokeMeshes.current.forEach((sm) => {
        if (sm) sm.visible = false;
      });
    }
  });

  if (!entity || entity.dead) return null;

  return (
    <group position={[entity.x, 0, entity.z]} scale={[entity.scale, entity.scale, entity.scale]}>
      <group ref={intact} rotation={[0, 0, entity.lean || 0]}>
        {intactModel ? (
          <primitive object={intactModel} />
        ) : (
          <>
            <mesh position={[0, 9, 0]}>
              <cylinderGeometry args={[1.7, 2.8, 18, 8]} />
              <meshStandardMaterial color={entity.trunkColor || '#7c4a22'} roughness={0.96} />
            </mesh>
            <mesh position={[0, 20, 0]}>
              <sphereGeometry args={[8, 10, 10]} />
              <meshStandardMaterial color={entity.canopyColor || entity.color || '#166534'} roughness={0.92} />
            </mesh>
          </>
        )}
      </group>
      <group ref={broken} visible={false}>
        {brokenModel ? (
          <primitive object={brokenModel} />
        ) : (
          <mesh position={[0, 7, 0]}>
            <cylinderGeometry args={[2.1, 2.7, 14, 8]} />
            <meshStandardMaterial color="#45210b" roughness={1} />
          </mesh>
        )}
        <mesh position={[0, 1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[5, 12]} />
          <meshBasicMaterial color="#9a3412" transparent opacity={0.4} />
        </mesh>
        {[0, 1].map((i) => (
          <mesh
            key={`tree-smoke-${i}`}
            visible={false}
            ref={(el) => {
              smokeMeshes.current[i] = el;
              if (el) {
                el.userData.baseY = 10 + i * 3;
                el.userData.baseScale = 0.8 + i * 0.2;
              }
            }}
            position={[(i === 0 ? -2 : 3), 10 + i * 3, (i === 0 ? 2 : -1)]}
          >
            <sphereGeometry args={[2 + i, 8, 8]} />
            <meshBasicMaterial color="#333333" transparent opacity={0.28} />
          </mesh>
        ))}
      </group>
    </group>
  );
});

// Corpse - dead person/soldier remains on ground
const EntityCorpse = memo(({ entityId, index, entitiesRef, entityLookupRef }) => {
  const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  if (!p || p.dead) return null;
  
  return (
    <group position={[p.x, 2, p.z]} rotation={[0, Math.random() * Math.PI * 2, 0]}>
      {/* Body lying down */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[3, 8, 4, 8]} />
        <meshLambertMaterial color={p.color || '#666666'} />
      </mesh>
      {/* Head */}
      <mesh position={[6, 0, 0]}>
        <sphereGeometry args={[3, 8, 8]} />
        <meshLambertMaterial color="#fcd34d" />
      </mesh>
      {/* Blood stain */}
      <mesh position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[5, 12]} />
        <meshBasicMaterial color="#7f1d1d" transparent opacity={0.6} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
      </mesh>
    </group>
  );
});

const EntityKaijuCorpse = memo(({ entityId, index, entitiesRef, entityLookupRef }) => {
  const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  if (!p || p.dead) return null;

  const scale = p.scale || 5;
  const tone = p.variant === 'octopus'
    ? '#581c87'
    : p.variant === 'spider'
    ? '#111827'
    : p.variant === 'beetle'
    ? '#78350f'
    : p.variant === 'wyrm'
    ? '#14532d'
    : p.variant === 'spicie_bird'
    ? '#374151'
    : '#3f3f46';
  const glowTone = p.variant === 'octopus' ? '#a78bfa' : p.variant === 'spicie_bird' ? '#f59e0b' : '#fb923c';

  return (
    <group position={[p.x, (p.y || 0) + Math.max(1.5, scale * 0.12), p.z]} rotation={[0.18, p.rotation || 0, Math.PI / 2.8]}>
      <mesh scale={[scale * 1.15, scale * 0.4, scale * 0.75]}>
        <capsuleGeometry args={[10, 26, 6, 10]} />
        <meshStandardMaterial color={tone} roughness={0.96} metalness={0.04} />
      </mesh>
      <mesh position={[scale * 0.62, 0, 0]} scale={[scale * 0.55, scale * 0.3, scale * 0.44]}>
        <sphereGeometry args={[10, 10, 10]} />
        <meshStandardMaterial color={tone} roughness={0.98} metalness={0.03} />
      </mesh>
      <mesh position={[-scale * 0.28, -scale * 0.06, 0]} scale={[scale * 1.05, scale * 0.12, scale * 0.95]}>
        <cylinderGeometry args={[11, 16, 10, 12]} />
        <meshBasicMaterial color={glowTone} transparent opacity={0.14} depthWrite={false} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh
          key={`kaiju-corpse-smoke-${i}`}
          position={[-scale * 0.15 + i * scale * 0.16, scale * (0.16 + i * 0.05), (i - 1) * scale * 0.1]}
          scale={[scale * 0.12, scale * 0.2, scale * 0.12]}
        >
          <sphereGeometry args={[8, 8, 8]} />
          <meshBasicMaterial color="#1f2937" transparent opacity={0.18 - i * 0.03} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
});

const EntityScorch = memo(({ entityId, index, entitiesRef, entityLookupRef }) => {
  const initial = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  if (!initial || initial.dead) return null;

  const group = useRef();
  const emberRef = useRef();
  const heatRef = useRef();
  const smokeRefs = useRef([]);
  const flameRefs = useRef([]);

  const radius = initial.radius || 40;
  const smokeCount = Math.max(0, Math.min(10, initial.smokeCount ?? 6));
  const flameCount = Math.max(0, Math.min(10, initial.flameCount ?? 0));

  const smokeData = useMemo(() => (
    [...Array(smokeCount)].map((_, i) => {
      const angle = (i / Math.max(1, smokeCount)) * Math.PI * 2 + Math.random() * 0.9;
      const distance = Math.random() * radius * 0.42;
      return {
        x: Math.cos(angle) * distance,
        z: Math.sin(angle) * distance,
        phase: Math.random() * Math.PI * 2,
        riseRate: 0.2 + Math.random() * 0.28,
        drift: 1.2 + Math.random() * 2.8,
        scale: 0.8 + Math.random() * 1.3,
        opacity: 0.16 + Math.random() * 0.18
      };
    })
  ), [radius, smokeCount]);

  const flameData = useMemo(() => (
    [...Array(flameCount)].map((_, i) => {
      const angle = (i / Math.max(1, flameCount)) * Math.PI * 2 + Math.random() * 0.45;
      const distance = radius * (0.18 + Math.random() * 0.48);
      return {
        x: Math.cos(angle) * distance,
        z: Math.sin(angle) * distance,
        width: 4 + Math.random() * 4.5,
        height: 10 + Math.random() * 10,
        rotation: Math.random() * Math.PI,
        phase: Math.random() * Math.PI * 2,
        opacity: 0.42 + Math.random() * 0.24
      };
    })
  ), [flameCount, radius]);

  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) {
      if (group.current) group.current.visible = false;
      return;
    }

    p.age = (p.age || 0) + delta;
    const lifeFade = p.ttl ? Math.max(0, 1 - p.age / Math.max(0.01, p.ttl)) : 1;
    if (p.ttl && lifeFade <= 0.01) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }

    const burnLife = Math.max(0.1, p.burnLife || p.ttl || 10);
    const flameFade = flameCount > 0 ? Math.max(0, 1 - p.age / burnLife) : 0;
    const smokeLife = Math.max(0.1, p.smokeLife || p.burnLife || (p.kind === 'nuke_core' ? NUKE_AFTERFIRE_CORE_LIFETIME : p.kind === 'nuke_fire_patch' ? NUKE_AFTERFIRE_PATCH_TTL : 6));
    const smokeFade = Math.max(0, 1 - p.age / smokeLife);
    const coreLife = Math.max(0.1, p.coreLife || p.burnLife || (p.kind === 'nuke_core' ? NUKE_AFTERFIRE_CORE_LIFETIME : 8));
    const coreFade = Math.max(0, 1 - p.age / coreLife);
    if (!p.ttl && coreFade <= 0.01 && smokeFade <= 0.01 && flameFade <= 0.01) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }
    const pulse = 0.86 + Math.sin(state.clock.elapsedTime * (p.firePulseSpeed || 4.2) + radius * 0.01) * 0.14;
    const baseHeight = getTerrainHeight(p.x, p.z);

    if (group.current) {
      group.current.visible = true;
      group.current.position.set(p.x, baseHeight + 0.5, p.z);
    }

    if (emberRef.current?.material) {
      emberRef.current.material.opacity = (p.coreOpacity ?? 0.5) * Math.max(coreFade, flameFade * 0.92) * lifeFade * pulse;
    }
    if (heatRef.current?.material) {
      heatRef.current.material.opacity = (p.heatOpacity ?? 0.12) * Math.max(flameFade, smokeFade * 0.55) * lifeFade * pulse;
    }
    if (heatRef.current) {
      heatRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 2.6 + radius * 0.02) * 0.03);
      heatRef.current.position.y = 0.28;
    }

    flameRefs.current.forEach((flame, i) => {
      if (!flame || !flame.material) return;
      const data = flameData[i];
      const active = flameFade > 0.02 && !!data;
      flame.visible = active;
      if (!active) return;
      const flicker = 0.75 + Math.sin(state.clock.elapsedTime * 9 + data.phase) * 0.16 + Math.cos(state.clock.elapsedTime * 6.5 + i) * 0.08;
      flame.position.set(data.x, 2.4 + flicker * 1.6, data.z);
      flame.rotation.y = data.rotation + Math.sin(state.clock.elapsedTime * 1.2 + data.phase) * 0.24;
      flame.scale.set(data.width * flicker, data.height * (0.72 + flicker * 0.45), data.width * flicker);
      flame.material.opacity = data.opacity * flameFade * lifeFade;
    });

    smokeRefs.current.forEach((smoke, i) => {
      if (!smoke || !smoke.material) return;
      const data = smokeData[i];
      const active = smokeFade > 0.02 && !!data;
      smoke.visible = active;
      if (!active) return;
      const rise = ((p.age || 0) * data.riseRate + i * 0.13) % 1;
      smoke.position.set(
        data.x + Math.sin(state.clock.elapsedTime * 0.8 + data.phase) * data.drift,
        3 + rise * (10 + radius * 0.16),
        data.z + Math.cos(state.clock.elapsedTime * 0.7 + data.phase) * data.drift
      );
      const scale = data.scale + rise * (0.6 + radius * 0.01);
      smoke.scale.set(scale, scale * 1.24, scale);
      smoke.material.opacity = data.opacity * Math.max(smokeFade, flameFade * 0.65) * lifeFade * (1 - rise * 0.72);
    });
  });

  return (
    <group ref={group} position={[initial.x, getTerrainHeight(initial.x, initial.z) + 0.5, initial.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius, 18]} />
        <meshBasicMaterial
          color={initial.baseColor || '#0b0703'}
          transparent
          opacity={initial.baseOpacity ?? 0.9}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-4}
        />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <ringGeometry args={[radius * 0.82, radius, 24]} />
        <meshBasicMaterial
          color={initial.ringColor || '#1c1209'}
          transparent
          opacity={0.88}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-4}
        />
      </mesh>

      <mesh ref={heatRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.28, 0]} visible={flameCount > 0}>
        <ringGeometry args={[radius * 0.56, initial.burnRadius || radius * 1.35, 28]} />
        <meshBasicMaterial
          color={initial.heatColor || '#ff7b00'}
          transparent
          opacity={0.14}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      <mesh ref={emberRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.16, 0]}>
        <circleGeometry args={[radius * 0.42, 16]} />
        <meshBasicMaterial
          color={initial.coreColor || '#ff4d00'}
          transparent
          opacity={initial.coreOpacity ?? 0.5}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-4}
        />
      </mesh>

      {flameData.map((_, i) => (
        <mesh
          key={`scorch-flame-${i}`}
          ref={el => { flameRefs.current[i] = el; }}
          visible={false}
          position={[0, 2, 0]}
        >
          <coneGeometry args={[1, 1, 6]} />
          <meshBasicMaterial
            color={i % 2 === 0 ? '#ff7b00' : '#ffd166'}
            transparent
            opacity={0.6}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}

      {smokeData.map((_, i) => (
        <mesh
          key={`scorch-smoke-${i}`}
          ref={el => { smokeRefs.current[i] = el; }}
          visible={false}
          position={[0, 3, 0]}
        >
          <sphereGeometry args={[2.2, 6, 6]} />
          <meshBasicMaterial color="#2a211d" transparent opacity={0.24} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
});
// Kaiju attack impact effect - variant-specific attacks
const EntityKaijuAttack = ({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const materials = useRef([]);
  const meshes = useRef([]);
  const age = useRef(0);
  const pos = useRef(null);
  const sourcePos = useRef(null);
  const attackType = useRef('fireball');
  const started = useRef(false);

  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) {
      if (group.current) group.current.visible = false;
      return;
    }
    
    if (!started.current && p.x !== undefined) {
      pos.current = { x: p.x, y: p.y || 0, z: p.z };
      sourcePos.current = { x: p.sourceX || p.x, y: p.sourceY || 30, z: p.sourceZ || p.z };
      attackType.current = p.attackType || 'fireball';
      started.current = true;
    }
    
    if (started.current) {
      age.current += delta;
      if (age.current > 1.5) {
        p.dead = true;
        if (group.current) group.current.visible = false;
        return;
      }
      
      const progress = age.current / 1.5;
      const scale = 1 + progress * 5;
      const opacity = Math.max(0, 1 - progress);
      const flashIntensity = Math.max(0, 1 - progress * 1.5);
      
      if (group.current) {
          group.current.position.set(pos.current.x, pos.current.y, pos.current.z);
          group.current.visible = true;
          if (attackType.current !== 'lightning') {
              group.current.scale.set(scale, scale, scale);
          }
      }
      
      if (attackType.current === 'lightning') {
          materials.current.forEach(mat => {
              if (mat) {
                 mat.opacity = mat._origBaseOpacity ? mat._origBaseOpacity * opacity : opacity;
                 if (mat.emissiveIntensity !== undefined && mat._origEmissive) {
                     mat.emissiveIntensity = mat._origEmissive * flashIntensity;
                 }
              }
          });
          meshes.current.forEach((mesh, i) => {
              if (mesh && mesh._isSpark) {
                 const sparkProgress = progress * 30;
                 const angle = (i / 12) * Math.PI * 2;
                 const height = Math.sin(progress * Math.PI * 2 + i) * 15;
                 mesh.position.set(Math.cos(angle) * sparkProgress, height, Math.sin(angle) * sparkProgress);
              } else if (mesh && mesh._isSeg) {
                 const t = mesh._t;
                 const jitter = Math.sin(mesh._i * 7 + age.current * 20) * 8;
                 const segX = sourcePos.current.x + (pos.current.x - sourcePos.current.x) * t - pos.current.x; 
                 const segY = sourcePos.current.y + (pos.current.y - sourcePos.current.y) * t - Math.sin(t * Math.PI) * 30 - pos.current.y;
                 const segZ = sourcePos.current.z + (pos.current.z - sourcePos.current.z) * t - pos.current.z;
                 mesh.position.set(segX + jitter, segY, segZ + jitter * 0.5);
              }
          });
      } else if (attackType.current === 'ink') {
          materials.current.forEach(mat => {
              if (mat) {
                 mat.opacity = mat._origBaseOpacity ? mat._origBaseOpacity * opacity : opacity;
                 if (mat.emissiveIntensity !== undefined && mat._origEmissive) {
                     mat.emissiveIntensity = mat._origEmissive * (mat._isPurple ? flashIntensity : 1);
                 }
              }
          });
          meshes.current.forEach((mesh) => {
             if (mesh && mesh._isSplatter) {
                 const dist = progress * 35;
                 const angle = mesh._angle;
                 const height = Math.sin(progress * Math.PI) * 20 + progress * 10;
                 mesh.position.set(Math.cos(angle) * dist, height, Math.sin(angle) * dist);
             } else if (mesh && mesh._isMist) {
                 mesh.position.set(0, 15 + progress * 10, 0);
                 const ms = 20 + progress * 10;
                 mesh.scale.set(ms/20, ms/20, ms/20);
             }
          });
      } else if (attackType.current === 'web') {
          materials.current.forEach(mat => {
              if (!mat) return;
              mat.opacity = 0;
              if (mat.emissiveIntensity !== undefined) {
                  mat.emissiveIntensity = 0;
              }
          });
          meshes.current.forEach((mesh, i) => {
             if (!mesh || !mesh.material) return;
             if (mesh._isWebRing) {
                 const ringScale = 1 + progress * (mesh._ringBoost || 3.5);
                 mesh.scale.set(ringScale, ringScale, 1);
                 mesh.material.opacity = (mesh._baseOpacity || 0.5) * opacity;
                 if (mesh.material.emissiveIntensity !== undefined) {
                     mesh.material.emissiveIntensity = 2.4 * flashIntensity;
                 }
             } else if (mesh._isWebStrand) {
                 mesh.rotation.z = mesh._baseRot + Math.sin(age.current * 8 + i) * 0.06;
                 mesh.scale.set(1, 1 + progress * 1.8, 1);
                 mesh.material.opacity = 0.38 * opacity;
             } else if (mesh._isWebCore) {
                 const pulse = 1 + Math.sin(age.current * 16) * 0.12;
                 mesh.scale.setScalar((1 + progress * 1.5) * pulse);
                 mesh.material.opacity = 0.7 * opacity;
                 if (mesh.material.emissiveIntensity !== undefined) {
                     mesh.material.emissiveIntensity = 4.5 * flashIntensity;
                 }
             } else if (mesh._isWebShard) {
                 const angle = mesh._baseAngle;
                 const dist = 8 + progress * 28;
                 const height = 4 + Math.sin(progress * Math.PI) * 8 + mesh._heightOffset;
                 mesh.position.set(Math.cos(angle) * dist, height, Math.sin(angle) * dist);
                 mesh.material.opacity = 0.45 * opacity;
             } else {
                 mesh.material.opacity = 0;
                 if (mesh.material.emissiveIntensity !== undefined) {
                     mesh.material.emissiveIntensity = 0;
                 }
             }
          });
      } else {
          materials.current.forEach(mat => {
              if (mat) {
                  mat.opacity = mat._origBaseOpacity ? mat._origBaseOpacity * opacity : opacity;
                  if (mat.emissiveIntensity !== undefined && mat._origEmissive) {
                     mat.emissiveIntensity = mat._origEmissive * (mat._isCore ? flashIntensity : opacity);
                  }
              }
          });
          meshes.current.forEach((mesh) => {
             if (mesh && mesh._isRingInner) {
                 const outer = 10 + progress * 40;
                 mesh.scale.set(outer/10, outer/10, outer/10); 
             } else if (mesh && mesh._isRingOuter) {
                 const outer = 15 + progress * 55;
                 mesh.scale.set(outer/15, outer/15, outer/15);
             } else if (mesh && mesh._isDebris) {
                 const angle = mesh._baseAngle + progress * 0.5;
                 const dist = progress * 35;
                 const height = Math.sin(progress * Math.PI) * 20 + progress * 12;
                 mesh.position.set(Math.cos(angle) * dist, height, Math.sin(angle) * dist);
             } else if (mesh && mesh._isPlume) {
                 mesh.position.set(0, 8 * progress, 0);
                 const s = (8 + progress * 5)/8;
                 mesh.scale.set(s,s,s);
             } else if (mesh && mesh._isSecondarySmoke) {
                 mesh.position.set(5, 20 + progress * 15, -3);
                 const s = (8 + progress * 5)/8;
                 mesh.scale.set(s,s,s);
             }
          });
      }
    }
  });

  return (
    <group ref={group} visible={false}>
      {/* Lightning, Ink, and Fireball share the same group, their specific opacity drops to 0 when filtered by tags logic above */}
      
      {/* Lightning Attack */}
      {[0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((t, i) => (
        <mesh key={`seg-${i}`} ref={el => { if(el) { el._isSeg = true; el._t = t; el._i = i; meshes.current.push(el); } }}>
          <sphereGeometry args={[3 + Math.random() * 2, 8, 8]} />
          <meshStandardMaterial ref={el => { if(el) { el._origBaseOpacity = 1; el._origEmissive = 10; materials.current.push(el); } }} color="#00ffff" emissive="#00ffff" transparent opacity={0}/>
        </mesh>
      ))}
      <mesh position={[0, 10, 0]} ref={el => { if(el) { el._isLightningImpact = true; meshes.current.push(el); } }}>
        <sphereGeometry args={[15, 16, 16]} />
        <meshStandardMaterial ref={el => { if(el) { el._origBaseOpacity = 0.8; el._origEmissive = 6; materials.current.push(el); } }} color="#ffffff" emissive="#00ffff" transparent opacity={0}/>
      </mesh>
      {[...Array(12)].map((_, i) => (
        <mesh key={`spark-${i}`} ref={el => { if(el) { el._isSpark = true; meshes.current.push(el); } }}>
          <boxGeometry args={[2, 2, 2]} />
          <meshBasicMaterial ref={el => { if(el) { el._origBaseOpacity = 1; materials.current.push(el); } }} color="#00ffff" transparent opacity={0}/>
        </mesh>
      ))}

      {/* Ink Attack */}
      <mesh position={[0, 8, 0]} ref={el => { if(el) { el._isInkCore = true; meshes.current.push(el); } }}>
        <sphereGeometry args={[18, 16, 16]} />
        <meshStandardMaterial ref={el => { if(el) { el._origBaseOpacity = 0.9; materials.current.push(el); } }} color="#1a0a2e" transparent opacity={0}/>
      </mesh>
      <mesh position={[0, 10, 0]} ref={el => { if(el) { el._isInkGlow = true; meshes.current.push(el); } }}>
        <sphereGeometry args={[12, 12, 12]} />
        <meshStandardMaterial ref={el => { if(el) { el._origBaseOpacity = 0.7; el._origEmissive = 3; el._isPurple = true; materials.current.push(el); } }} color="#7c3aed" emissive="#5b21b6" transparent opacity={0}/>
      </mesh>
      {[...Array(16)].map((_, i) => (
        <mesh key={`ink-${i}`} ref={el => { if(el) { el._isSplatter = true; el._angle = (i / 16) * Math.PI * 2; meshes.current.push(el); } }}>
          <sphereGeometry args={[3 + Math.random() * 2, 8, 8]} />
          <meshStandardMaterial ref={el => { if(el) { el._origBaseOpacity = 0.8; el._origEmissive = 2; materials.current.push(el); } }} color="#4c1d95" emissive="#6b21a8" transparent opacity={0}/>
        </mesh>
      ))}
      <mesh position={[0, 15, 0]} ref={el => { if(el) { el._isMist = true; meshes.current.push(el); } }}>
        <sphereGeometry args={[20, 12, 12]} />
        <meshBasicMaterial ref={el => { if(el) { el._origBaseOpacity = 0.4; materials.current.push(el); } }} color="#2d1b4e" transparent opacity={0}/>
      </mesh>

      {/* Web Attack */}
      <mesh position={[0, 4, 0]} ref={el => { if(el) { el._isWebCore = true; meshes.current.push(el); } }}>
        <sphereGeometry args={[6, 12, 12]} />
        <meshStandardMaterial color="#dbeafe" emissive="#93c5fd" emissiveIntensity={0} transparent opacity={0}/>
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.4, 0]} ref={el => { if (el) { el._isWebRing = true; el._ringBoost = 3.2; el._baseOpacity = 0.55; meshes.current.push(el); } }}>
        <ringGeometry args={[6, 10, 32]} />
        <meshBasicMaterial color="#bfdbfe" transparent side={2} opacity={0}/>
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.1, 0]} ref={el => { if (el) { el._isWebRing = true; el._ringBoost = 4.5; el._baseOpacity = 0.35; meshes.current.push(el); } }}>
        <ringGeometry args={[12, 16, 32]} />
        <meshBasicMaterial color="#dbeafe" transparent side={2} opacity={0}/>
      </mesh>
      {[...Array(8)].map((_, i) => (
        <mesh
          key={`web-strand-${i}`}
          position={[0, 1.2, 0]}
          rotation={[-Math.PI / 2, 0, (i / 8) * Math.PI * 2]}
          ref={el => {
            if (el) {
              el._isWebStrand = true;
              el._baseRot = (i / 8) * Math.PI * 2;
              meshes.current.push(el);
            }
          }}
        >
          <planeGeometry args={[1.2, 28]} />
          <meshBasicMaterial color="#dbeafe" transparent side={2} opacity={0}/>
        </mesh>
      ))}
      {[...Array(6)].map((_, i) => (
        <mesh
          key={`web-shard-${i}`}
          ref={el => {
            if (el) {
              el._isWebShard = true;
              el._baseAngle = (i / 6) * Math.PI * 2;
              el._heightOffset = (i % 2) * 2;
              meshes.current.push(el);
            }
          }}
        >
          <sphereGeometry args={[1.8 + (i % 3) * 0.4, 8, 8]} />
          <meshStandardMaterial color="#93c5fd" emissive="#60a5fa" emissiveIntensity={0} transparent opacity={0}/>
        </mesh>
      ))}

      {/* Fireball Attack */}
      <mesh position={[0, 10, 0]} ref={el => { if(el) { el._isFireball = true; meshes.current.push(el); } }}>
        <sphereGeometry args={[8, 20, 20]} />
        <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 1; el._origEmissive = 8; el._isCore = true; materials.current.push(el); } }} color="#ffffff" emissive="#ffffff" transparent opacity={0}/>
      </mesh>
      <mesh position={[0, 8, 0]} ref={el => { if(el) { el._isFireball = true; meshes.current.push(el); } }}>
        <sphereGeometry args={[14, 20, 20]} />
        <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 0.95; el._origEmissive = 4; materials.current.push(el); } }} color="#ff8800" emissive="#ff6600" transparent opacity={0}/>
      </mesh>
      <mesh position={[0, 6, 0]} ref={el => { if(el) { el._isFireball = true; meshes.current.push(el); } }}>
        <sphereGeometry args={[20, 16, 16]} />
        <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 0.8; el._origEmissive = 3; materials.current.push(el); } }} color="#ff4400" emissive="#ff2200" transparent opacity={0}/>
      </mesh>
      <mesh position={[0, 4, 0]} ref={el => { if(el) { el._isFireball = true; meshes.current.push(el); } }}>
        <sphereGeometry args={[25, 12, 12]} />
        <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 0.5; materials.current.push(el); } }} color="#331111" transparent opacity={0}/>
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 2, 0]} ref={el => { if (el) { el._isRingInner = true; meshes.current.push(el); } }}>
        <ringGeometry args={[5, 10, 48]} />
        <meshBasicMaterial ref={el => { if(el){ el._origBaseOpacity = 0.9; materials.current.push(el); } }} color="#ffaa00" transparent side={2} opacity={0}/>
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1, 0]} ref={el => { if (el) { el._isRingOuter = true; meshes.current.push(el); } }}>
        <ringGeometry args={[10, 15, 48]} />
        <meshBasicMaterial ref={el => { if(el){ el._origBaseOpacity = 0.6; materials.current.push(el); } }} color="#ff6600" transparent side={2} opacity={0}/>
      </mesh>
      {[...Array(16)].map((_, i) => {
         const size = 2 + Math.sin(i * 3) * 1.5;
         const colors = ['#ffcc00', '#ff8800', '#ff4400', '#ff2200'];
         return (
           <mesh key={`debris-${i}`} ref={el => { if(el){ el._isDebris = true; el._baseAngle = (i / 16) * Math.PI * 2; meshes.current.push(el); } }}>
             <boxGeometry args={[size, size * 1.5, size]} />
             <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 1; el._origEmissive = 3; materials.current.push(el); } }} color={colors[i % 4]} emissive={colors[i % 4]} transparent opacity={0}/>
           </mesh>
         );
      })}
      <mesh position={[0, 8, 0]} ref={el => { if(el){ el._isPlume = true; meshes.current.push(el); } }}>
        <sphereGeometry args={[8, 12, 12]} />
        <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 0.5; materials.current.push(el); } }} color="#222222" transparent opacity={0}/>
      </mesh>
      <mesh position={[5, 20, -3]} ref={el => { if(el){ el._isSecondarySmoke = true; meshes.current.push(el); } }}>
        <sphereGeometry args={[8, 10, 10]} />
        <meshStandardMaterial ref={el => { if(el){ el._origBaseOpacity = 0.4; materials.current.push(el); } }} color="#333333" transparent opacity={0}/>
      </mesh>
    </group>
  );
};

// Kaiju fire breath effect - dramatic flame
const EntityFireBreath = ({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const meshes = useRef([]);
  const materials = useRef([]);
  const age = useRef(0);
  const pos = useRef(null);

  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    
    if (!pos.current && p.x !== undefined) {
      pos.current = { x: p.x, y: p.y, z: p.z, targetX: p.targetX, targetZ: p.targetZ };
    }
    if (!pos.current) return;
    
    age.current += delta;
    if (age.current > 1.2) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }

    if (group.current && !group.current.visible) {
       group.current.position.set(pos.current.x, pos.current.y, pos.current.z);
       const dx = pos.current.targetX - pos.current.x;
       const dz = pos.current.targetZ - pos.current.z;
       group.current.rotation.y = -Math.atan2(dz, dx);
       group.current.visible = true;
    }

    const progress = age.current / 1.2;
    const opacity = Math.max(0, 1 - progress);
    const intensity = Math.max(0, 1 - progress * 0.3);

    materials.current.forEach(mat => {
        if (!mat) return;
        mat.opacity = mat._origOpacity ? mat._origOpacity * opacity : opacity;
        if (mat.emissiveIntensity !== undefined && mat._origEmissive) {
            mat.emissiveIntensity = mat._origEmissive * intensity;
        }
    });

    meshes.current.forEach((mesh) => {
        if (!mesh) return;
        if (mesh._isCore) {
            const t = mesh._t;
            const dist = progress * 300 * t;
            const yOffset = Math.sin(t * Math.PI) * 8;
            mesh.position.set(dist, yOffset, 0);
        } else if (mesh._isTrail) {
            const i = mesh._i;
            const angle = (i / 12) * Math.PI * 2;
            const dist = progress * 180 + (Math.sin(i * 7) * 30);
            const height = Math.sin(progress * Math.PI * 3 + i) * 12;
            mesh.position.set(dist, height, Math.cos(angle) * 15);
        } else if (mesh._isSmoke) {
            mesh.position.set(progress * 150, 20 + progress * 8, 0);
            mesh.visible = age.current > 0.3;
        } else if (mesh._isGlow) {
            mesh.position.set(progress * 120, 1, 0);
            const r = 40 + progress * 25;
            mesh.scale.set(r/40, r/40, r/40);
        }
    });
  });

  return (
    <group ref={group} visible={false}>
      {[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((t, i) => (
        <mesh key={`core-${i}`} ref={el => { if(el) { el._isCore = true; el._t = t; meshes.current.push(el); } }}>
          <sphereGeometry args={[4 + t * 30, 14, 14]} />
          <meshStandardMaterial ref={el => { if(el) { el._origOpacity = 1 - t * 0.7; el._origEmissive = 5; materials.current.push(el); } }} 
             color={i < 2 ? '#ffffff' : i < 4 ? '#ffee00' : i < 6 ? '#ff8800' : '#ff4400'}
             emissive={i < 2 ? '#ffffff' : i < 4 ? '#ffdd00' : i < 6 ? '#ff6600' : '#ff2200'} transparent />
        </mesh>
      ))}
      {[...Array(12)].map((_, i) => (
        <mesh key={`trail-${i}`} ref={el => { if(el) { el._isTrail = true; el._i = i; meshes.current.push(el); } }}>
          <sphereGeometry args={[3 + Math.sin(i * 5) * 2, 10, 10]} />
          <meshStandardMaterial ref={el => { if(el){ el._origOpacity = 0.8; el._origEmissive = 3; materials.current.push(el); } }}
             color="#ff6600" emissive="#ff4400" transparent />
        </mesh>
      ))}
      <mesh ref={el => { if(el){ el._isSmoke = true; meshes.current.push(el); } }}>
         <sphereGeometry args={[25, 12, 12]} />
         <meshStandardMaterial ref={el => { if(el){ el._origOpacity = 0.4; materials.current.push(el); } }} color="#2a2a2a" transparent />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} ref={el => { if(el) { el._isGlow = true; meshes.current.push(el); } }}>
         <circleGeometry args={[40, 24]} />
         <meshBasicMaterial ref={el => { if(el){ el._origOpacity = 0.5; materials.current.push(el); } }} color="#ff6600" transparent />
      </mesh>
    </group>
  );
};

// Bullet tracer effect - small fast projectile
const EntityBullet = ({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const trail = useRef();
  const age = useRef(0);
  const pos = useRef(null);
  const targetPos = useRef(null);

  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    
    if (!pos.current && p.x !== undefined) pos.current = { x: p.x, y: p.y, z: p.z };
    if (!targetPos.current && p.targetX !== undefined) targetPos.current = { x: p.targetX, y: p.targetY, z: p.targetZ };
    
    if (!pos.current || !targetPos.current) return;
    
    age.current += delta;
    if (age.current > 0.3) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }

    const progress = age.current / 0.3;
    if (group.current) {
        group.current.position.set(
           pos.current.x + (targetPos.current.x - pos.current.x) * progress,
           pos.current.y + (targetPos.current.y - pos.current.y) * progress,
           pos.current.z + (targetPos.current.z - pos.current.z) * progress
        );
        group.current.visible = true;
    }
    if (trail.current) {
        trail.current.position.set(
           -(targetPos.current.x - pos.current.x) * progress * 0.1,
           -(targetPos.current.y - pos.current.y) * progress * 0.1,
           -(targetPos.current.z - pos.current.z) * progress * 0.1
        );
    }
  });

  return (
    <group ref={group} visible={false}>
      <mesh>
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial color="#ffff00" />
      </mesh>
      <mesh ref={trail}>
        <sphereGeometry args={[0.5, 4, 4]} />
        <meshBasicMaterial color="#ffaa00" transparent opacity={0.6} />
      </mesh>
    </group>
  );
};

// Tank shell effect - larger projectile with trail
const EntityShell = ({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const trails = useRef([]);
  const age = useRef(0);
  const pos = useRef(null);
  const targetPos = useRef(null);

  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    
    if (!pos.current && p.x !== undefined) pos.current = { x: p.x, y: p.y, z: p.z };
    if (!targetPos.current && p.targetX !== undefined) targetPos.current = { x: p.targetX, y: p.targetY, z: p.targetZ };
    
    if (!pos.current || !targetPos.current) return;
    
    age.current += delta;
    if (age.current > 0.5) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }

    const progress = age.current / 0.5;
    if (group.current) {
        group.current.position.set(
           pos.current.x + (targetPos.current.x - pos.current.x) * progress,
           pos.current.y + (targetPos.current.y - pos.current.y) * progress,
           pos.current.z + (targetPos.current.z - pos.current.z) * progress
        );
        group.current.visible = true;
    }
    
    trails.current.forEach((mesh, i) => {
        if (!mesh) return;
        const t = (i + 1) * 0.1;
        const factor = (progress - t) * 0.15;
        mesh.position.set(
            -(targetPos.current.x - pos.current.x) * factor,
            -(targetPos.current.y - pos.current.y) * factor,
            -(targetPos.current.z - pos.current.z) * factor
        );
    });
  });

  return (
    <group ref={group} visible={false}>
      <mesh>
        <sphereGeometry args={[2, 8, 8]} />
        <meshStandardMaterial color="#ffaa00" emissive="#ff6600" emissiveIntensity={2} />
      </mesh>
      {[0.1, 0.2, 0.3].map((t, i) => (
        <mesh key={i} ref={el => trails.current[i] = el}>
          <sphereGeometry args={[1.5 - i * 0.3, 6, 6]} />
          <meshBasicMaterial color="#888888" transparent opacity={0.4 - i * 0.1} />
        </mesh>
      ))}
    </group>
  );
};

// Muzzle flash effect - quick bright flash when tank fires
const EntityMuzzleFlash = ({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const materials = useRef([]);
  const age = useRef(0);
  const pos = useRef(null);

  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    
    if (!pos.current && p.x !== undefined) pos.current = { x: p.x, y: p.y, z: p.z };
    if (!pos.current) return;
    
    age.current += delta;
    if (age.current > 0.15) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }

    const progress = age.current / 0.15;
    const scale = 1 + progress * 2;
    const opacity = 1 - progress;

    if (group.current) {
        group.current.position.set(pos.current.x, pos.current.y, pos.current.z);
        group.current.scale.set(scale, scale, scale);
        group.current.visible = true;
    }
    
    materials.current.forEach(mat => {
        if (!mat) return;
        mat.opacity = mat._origOpacity * opacity;
    });
  });

  return (
    <group ref={group} visible={false}>
      <mesh>
        <sphereGeometry args={[3, 8, 8]} />
        <meshBasicMaterial ref={el => { if(el) { el._origOpacity = 1; materials.current.push(el); } }} color="#ffffff" transparent />
      </mesh>
      <mesh>
        <sphereGeometry args={[5, 8, 8]} />
        <meshBasicMaterial ref={el => { if(el) { el._origOpacity = 0.8; materials.current.push(el); } }} color="#ff8800" transparent />
      </mesh>
      <mesh>
        <sphereGeometry args={[7, 6, 6]} />
        <meshBasicMaterial ref={el => { if(el) { el._origOpacity = 0.5; materials.current.push(el); } }} color="#ffcc00" transparent />
      </mesh>
    </group>
  );
};

const EntityJet = ({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  useFrame((state) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    group.current.position.set(p.x, p.y, p.z);
    group.current.rotation.y = -Math.atan2(p.vz || 0, p.vx || 1);
    // Slight roll when turning or high speed
    group.current.rotation.z = Math.sin(Date.now() * 0.01) * 0.05;
  });
  return (
    <group ref={group} scale={[0.6, 0.6, 0.6]}>
      {/* Sleek Delta Wing Body */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[4, 8, 120, 8]} />
        <meshStandardMaterial color="#4b5563" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Delta Wings */}
      <mesh position={[-20, 0, 0]} rotation={[0, 0, 0]}>
        <boxGeometry args={[60, 2, 100]} />
        <meshStandardMaterial color="#374151" metalness={0.7} />
      </mesh>
      {/* Cockpit Canopy */}
      <mesh position={[40, 5, 0]}>
        <sphereGeometry args={[5, 16, 16]} scale={[2, 1, 1]} />
        <meshStandardMaterial color="#1e293b" transparent opacity={0.6} metalness={0.9} />
      </mesh>
      {/* Afterburner glow */}
      <mesh position={[-65, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[4, 1, 15, 8]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
    </group>
  );
};

const EntityPlane = memo(({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const modelNodesRef = useRef({});
  const [assetReady, setAssetReady] = useState(Boolean(airstrikeAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(airstrikeAssetCache.error));

  const planeScene = useMemo(() => {
    if (!assetReady || !airstrikeAssetCache.scene) return null;
    const clone = cloneNamedGlbGroup(airstrikeAssetCache.scene, 'bomber_plane');
    modelNodesRef.current = clone?.userData?.namedNodes || {};
    return clone;
  }, [assetReady]);

  useEffect(() => {
    let cancelled = false;
    if (!assetReady && !assetFailed) {
      loadAirstrikeAsset()
        .then(() => {
          if (!cancelled) setAssetReady(true);
        })
        .catch(() => {
          if (!cancelled) setAssetFailed(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [assetReady, assetFailed]);

  useEffect(() => () => disposeClonedMaterials(planeScene), [planeScene]);

  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    if (!group.current) return;
    if (p.flightPhase === undefined) p.flightPhase = Math.random() * Math.PI * 2;

    const time = state.clock.elapsedTime;
    const targetYaw = -Math.atan2(p.vz || 0, p.vx || 0.001);
    const prevYaw = p.renderYaw ?? targetYaw;
    const yawDelta = Math.atan2(Math.sin(targetYaw - prevYaw), Math.cos(targetYaw - prevYaw));

    p.renderYaw = prevYaw + yawDelta * Math.min(1, delta * 3.5);
    p.renderRoll = THREE.MathUtils.lerp(
      p.renderRoll ?? 0,
      THREE.MathUtils.clamp(-yawDelta * 2.2, -PLANE_BANK_LIMIT, PLANE_BANK_LIMIT) + Math.sin(time * 1.4 + p.flightPhase) * 0.015,
      Math.min(1, delta * 2.8)
    );
    p.renderPitch = THREE.MathUtils.lerp(
      p.renderPitch ?? 0,
      Math.cos(time * 0.9 + p.flightPhase) * 0.025,
      Math.min(1, delta * 2.4)
    );

    group.current.position.set(p.x, (p.y || 350) + Math.sin(time * 1.1 + p.flightPhase) * 2.5, p.z);
    group.current.rotation.y = p.renderYaw;
    group.current.rotation.x = p.renderPitch;
    group.current.rotation.z = p.renderRoll;
    group.current.visible = true;

    [0, 1, 2, 3].forEach((i) => {
      const glow = modelNodesRef.current[`bomber_exhaust_glow_${i}`];
      if (glow) {
        setCloudOpacity(glow, 0.26 + Math.sin(time * 22 + i * 1.7 + p.flightPhase) * 0.08);
      }
    });
    [0, 1, 2, 3].forEach((i) => {
      const prop = modelNodesRef.current[`bomber_prop_${i}`];
      if (!prop) return;
      prop.rotation.x += delta * (28 + i * 2);
    });
  });
  return (
    <group ref={group} scale={[PLANE_MODEL_SCALE, PLANE_MODEL_SCALE, PLANE_MODEL_SCALE]}>
      {planeScene ? (
        <primitive object={planeScene} />
      ) : (
        <>
          <mesh rotation={[0, 0, -Math.PI / 2]}>
            <cylinderGeometry args={[11.5, 14, 268, 18]} />
            <meshStandardMaterial color="#8b949e" metalness={0.56} roughness={0.42} />
          </mesh>
          <mesh position={[-4, 5, 0]}>
            <boxGeometry args={[138, 4.6, 354]} />
            <meshStandardMaterial color="#8b949e" metalness={0.48} roughness={0.4} />
          </mesh>
          <mesh position={[88, 12, 0]} scale={[1.6, 0.8, 0.9]}>
            <sphereGeometry args={[11, 16, 12]} />
            <meshStandardMaterial color="#bcd3df" transparent opacity={0.48} metalness={0.82} roughness={0.08} />
          </mesh>
        </>
      )}
    </group>
  );
});

// === PARACHUTE-GUIDED NUCLEAR BOMB ===
const EntityBomb = memo(({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const modelNodesRef = useRef({});
  const [assetReady, setAssetReady] = useState(Boolean(airstrikeAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(airstrikeAssetCache.error));

  const bombScene = useMemo(() => {
    if (!assetReady || !airstrikeAssetCache.scene) return null;
    const clone = cloneNamedGlbGroup(airstrikeAssetCache.scene, 'nuke_bomb');
    modelNodesRef.current = clone?.userData?.namedNodes || {};
    return clone;
  }, [assetReady]);

  useEffect(() => {
    let cancelled = false;
    if (!assetReady && !assetFailed) {
      loadAirstrikeAsset()
        .then(() => {
          if (!cancelled) setAssetReady(true);
        })
        .catch(() => {
          if (!cancelled) setAssetFailed(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [assetReady, assetFailed]);

  useEffect(() => () => disposeClonedMaterials(bombScene), [bombScene]);
  
  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { 
      if (group.current) group.current.visible = false; 
      return; 
    }
    if (!group.current) return;

    const time = state.clock.elapsedTime;
    const inflation = p.chuteInflation ?? (p.parachuteOpen ? 1 : 0);
    const sway = p.swayAmount ?? 0;
    const heading = Math.atan2(p.vx || 0.001, p.vz || 0.001);
    const impactRock = p.impactPending ? Math.sin((p.impactTimer || 0) * 30) * 0.04 : 0;
    const isBombCamView = !!(p.isManual && window._falloutBombCamActive && window._falloutBombCamBombId === p.id);

    group.current.position.set(p.x, p.y || 400, p.z);
    group.current.rotation.y = heading;
    group.current.rotation.x = Math.sin(time * 1.4 + (p.swaySeed || 0)) * sway * 0.06 + impactRock;
    group.current.rotation.z = Math.cos(time * 1.8 + (p.swaySeed || 0)) * sway * 0.1;
    group.current.visible = !isBombCamView;

    const parachute = modelNodesRef.current.nuke_parachute;
    const cordsRoot = modelNodesRef.current.nuke_cords_root;
    const glow = modelNodesRef.current.nuke_status_glow;
    if (parachute) {
      parachute.visible = !isBombCamView && inflation > 0.02;
      parachute.scale.set(0.35 + inflation * 0.65, 0.2 + inflation * 0.8, 0.35 + inflation * 0.65);
      parachute.rotation.z = Math.sin(time * 1.5 + (p.swaySeed || 0)) * sway * 0.05;
    }
    if (cordsRoot) {
      cordsRoot.visible = !isBombCamView && inflation > 0.02;
      cordsRoot.scale.set(1, 0.3 + inflation * 0.7, 1);
    }
    if (glow) {
      setCloudOpacity(glow, isBombCamView ? 0 : 0.2 + Math.sin(time * 8 + (p.swaySeed || 0)) * 0.08);
    }
  });
  
  return (
    <group ref={group} scale={[BOMB_RENDER_SCALE, BOMB_RENDER_SCALE, BOMB_RENDER_SCALE]}>
       {bombScene ? (
         <primitive object={bombScene} />
       ) : (
         <>
           <mesh position={[0, 0, 0]}>
             <sphereGeometry args={[6.8, 18, 18]} />
             <meshStandardMaterial color="#4b5563" metalness={0.72} roughness={0.28} />
           </mesh>
           <mesh position={[0, -10.5, 0]}>
             <cylinderGeometry args={[5.6, 6.9, 20, 18]} />
             <meshStandardMaterial color="#6b7280" metalness={0.68} roughness={0.28} />
           </mesh>
           <mesh position={[0, -24, 0]}>
             <coneGeometry args={[5.2, 13, 14]} />
             <meshStandardMaterial color="#111827" metalness={0.7} roughness={0.24} />
           </mesh>
         </>
       )}
    </group>
  );
});

const NUKE_CLOUD_GLB_PATH = '/fallout/nuke_cloud.glb';
const NUKE_CLOUD_MAX_AGE = 210;
const nukeCloudAssetCache = {
  scene: null,
  promise: null,
  error: null
};

const cloneCloudMaterial = (material) => {
  if (!material) return material;
  const cloned = material.clone();
  cloned.transparent = true;
  cloned.depthWrite = false;
  return cloned;
};

const setCloudOpacity = (mesh, opacity) => {
  if (!mesh?.material) return;
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) => {
      if (!material) return;
      material.opacity = opacity;
      material.transparent = opacity < 0.999;
    });
    return;
  }
  mesh.material.opacity = opacity;
  mesh.material.transparent = opacity < 0.999;
};

const applyBaseScale = (mesh, scaleMultiplier, yOffset = 0) => {
  if (!mesh) return;
  const baseScale = mesh.userData.baseScale;
  const basePosition = mesh.userData.basePosition;
  if (baseScale) {
    mesh.scale.set(
      baseScale.x * scaleMultiplier,
      baseScale.y * scaleMultiplier,
      baseScale.z * scaleMultiplier
    );
  } else {
    mesh.scale.setScalar(scaleMultiplier);
  }
  if (basePosition) {
    mesh.position.set(basePosition.x, basePosition.y + yOffset, basePosition.z);
  }
};

const cloneNukeCloudScene = (scene) => {
  const clone = scene.clone(true);
  const namedNodes = {};
  clone.traverse((object) => {
    if (object.name) {
      namedNodes[object.name] = object;
      object.userData.basePosition = object.position.clone();
      object.userData.baseScale = object.scale.clone();
    }
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
    object.frustumCulled = false;
    if (Array.isArray(object.material)) {
      object.material = object.material.map(cloneCloudMaterial);
    } else {
      object.material = cloneCloudMaterial(object.material);
    }
  });
  clone.userData.namedNodes = namedNodes;
  return clone;
};

const loadNukeCloudAsset = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (nukeCloudAssetCache.scene) return Promise.resolve(nukeCloudAssetCache.scene);
  if (nukeCloudAssetCache.promise) return nukeCloudAssetCache.promise;

  const loader = new GLTFLoader();
  nukeCloudAssetCache.promise = loader.loadAsync(NUKE_CLOUD_GLB_PATH)
    .then((gltf) => {
      nukeCloudAssetCache.scene = gltf.scene;
      nukeCloudAssetCache.error = null;
      nukeCloudAssetCache.promise = null;
      return gltf.scene;
    })
    .catch((error) => {
      nukeCloudAssetCache.error = error;
      nukeCloudAssetCache.promise = null;
      console.error('Failed to load nuke cloud GLB', error);
      throw error;
    });

  return nukeCloudAssetCache.promise;
};

const WORLD_PROPS_GLB_PATH = '/fallout/world_props.glb';
const worldPropsAssetCache = {
  scene: null,
  promise: null,
  error: null
};

const cloneOpaqueMaterial = (material) => {
  if (!material) return material;
  return material.clone();
};

const cloneNamedGlbGroup = (scene, name) => {
  const source = scene?.getObjectByName?.(name);
  if (!source) return null;
  const clone = source.clone(true);
  const namedNodes = {};
  clone.traverse((object) => {
    if (object.name) {
      namedNodes[object.name] = object;
    }
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
    object.frustumCulled = false;
    if (Array.isArray(object.material)) {
      object.material = object.material.map(cloneOpaqueMaterial);
    } else {
      object.material = cloneOpaqueMaterial(object.material);
    }
  });
  clone.userData.namedNodes = namedNodes;
  return clone;
};

const disposeClonedMaterials = (object) => {
  if (!object) return;
  object.traverse((node) => {
    if (!node.isMesh) return;
    if (Array.isArray(node.material)) {
      node.material.forEach((material) => material?.dispose?.());
    } else {
      node.material?.dispose?.();
    }
  });
};

const tintPropClone = (object, palette = {}, emissiveMap = {}) => {
  if (!object) return;
  const entries = Object.entries(palette);
  if (!entries.length) return;
  object.traverse((node) => {
    if (!node.isMesh || !node.name) return;
    const match = entries.find(([prefix]) => node.name.startsWith(prefix));
    if (!match) return;
    const [prefix, colorValue] = match;
    const color = new THREE.Color(colorValue);
    const applyToMaterial = (material) => {
      if (!material?.color) return;
      material.color.copy(color);
      if (material.emissive && emissiveMap[prefix] !== undefined) {
        material.emissive.copy(color).multiplyScalar(emissiveMap[prefix]);
      }
    };
    if (Array.isArray(node.material)) {
      node.material.forEach(applyToMaterial);
    } else {
      applyToMaterial(node.material);
    }
  });
};

const loadWorldPropsAsset = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (worldPropsAssetCache.scene) return Promise.resolve(worldPropsAssetCache.scene);
  if (worldPropsAssetCache.promise) return worldPropsAssetCache.promise;

  const loader = new GLTFLoader();
  worldPropsAssetCache.promise = loader.loadAsync(WORLD_PROPS_GLB_PATH)
    .then((gltf) => {
      worldPropsAssetCache.scene = gltf.scene;
      worldPropsAssetCache.error = null;
      worldPropsAssetCache.promise = null;
      return gltf.scene;
    })
    .catch((error) => {
      worldPropsAssetCache.error = error;
      worldPropsAssetCache.promise = null;
      console.error('Failed to load world props GLB', error);
      throw error;
    });

  return worldPropsAssetCache.promise;
};

const AIRSTRIKE_ASSETS_GLB_PATH = '/fallout/airstrike_assets.glb';
const airstrikeAssetCache = {
  scene: null,
  promise: null,
  error: null
};

const BASE_STRUCTURES_GLB_PATH = '/fallout/base_structures.glb';
const baseStructuresAssetCache = {
  scene: null,
  promise: null,
  error: null
};
const KAIJU_ASSETS_GLB_PATH = '/fallout/kaiju_assets.glb';
const kaijuAssetsAssetCache = {
  scene: null,
  promise: null,
  error: null
};
const FACILITY_STRUCTURE_ASSET_NAMES = {
  powerplant: 'facility_powerplant',
  war_factory: 'facility_war_factory',
  field_hospital: 'facility_field_hospital',
  tech_lab: 'facility_tech_lab',
  radar_tower: 'facility_radar_tower',
  aa_site: 'facility_aa_site'
};
const FACILITY_BROKEN_STRUCTURE_ASSET_NAMES = Object.fromEntries(
  Object.entries(FACILITY_STRUCTURE_ASSET_NAMES).map(([key, value]) => [key, `${value}_broken`])
);
const BUNKER_STRUCTURE_ASSET_NAME = 'vault_bunker';
const BUNKER_BROKEN_STRUCTURE_ASSET_NAME = 'vault_bunker_broken';
const KAIJU_STRUCTURE_ASSET_NAMES = {
  godzilla: 'kaiju_godzilla',
  octopus: 'kaiju_octopus',
  spider: 'kaiju_spider',
  beetle: 'kaiju_beetle',
  wyrm: 'kaiju_wyrm',
  spicie_bird: 'kaiju_spicie_bird'
};

const loadAirstrikeAsset = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (airstrikeAssetCache.scene) return Promise.resolve(airstrikeAssetCache.scene);
  if (airstrikeAssetCache.promise) return airstrikeAssetCache.promise;

  const loader = new GLTFLoader();
  airstrikeAssetCache.promise = loader.loadAsync(AIRSTRIKE_ASSETS_GLB_PATH)
    .then((gltf) => {
      airstrikeAssetCache.scene = gltf.scene;
      airstrikeAssetCache.error = null;
      airstrikeAssetCache.promise = null;
      return gltf.scene;
    })
    .catch((error) => {
      airstrikeAssetCache.error = error;
      airstrikeAssetCache.promise = null;
      console.error('Failed to load airstrike assets GLB', error);
      throw error;
    });

  return airstrikeAssetCache.promise;
};

const loadBaseStructuresAsset = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (baseStructuresAssetCache.scene) return Promise.resolve(baseStructuresAssetCache.scene);
  if (baseStructuresAssetCache.promise) return baseStructuresAssetCache.promise;

  const loader = new GLTFLoader();
  baseStructuresAssetCache.promise = loader.loadAsync(BASE_STRUCTURES_GLB_PATH)
    .then((gltf) => {
      baseStructuresAssetCache.scene = gltf.scene;
      baseStructuresAssetCache.error = null;
      baseStructuresAssetCache.promise = null;
      return gltf.scene;
    })
    .catch((error) => {
      baseStructuresAssetCache.error = error;
      baseStructuresAssetCache.promise = null;
      console.error('Failed to load base structures GLB', error);
      throw error;
    });

  return baseStructuresAssetCache.promise;
};

const loadKaijuAssetsAsset = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (kaijuAssetsAssetCache.scene) return Promise.resolve(kaijuAssetsAssetCache.scene);
  if (kaijuAssetsAssetCache.promise) return kaijuAssetsAssetCache.promise;

  const loader = new GLTFLoader();
  kaijuAssetsAssetCache.promise = loader.loadAsync(KAIJU_ASSETS_GLB_PATH)
    .then((gltf) => {
      kaijuAssetsAssetCache.scene = gltf.scene;
      kaijuAssetsAssetCache.error = null;
      kaijuAssetsAssetCache.promise = null;
      return gltf.scene;
    })
    .catch((error) => {
      kaijuAssetsAssetCache.error = error;
      kaijuAssetsAssetCache.promise = null;
      console.error('Failed to load kaiju assets GLB', error);
      throw error;
    });

  return kaijuAssetsAssetCache.promise;
};

const EntityMushroomCloud = memo(({ entityId, index, entitiesRef, entityLookupRef }) => {
  const groupRef = useRef();
  const fallbackStemRef = useRef();
  const fallbackCapRef = useRef();
  const fallbackRingRef = useRef();
  const fallbackFlashRef = useRef();
  const fallbackEmberRef = useRef();
  const lightRef = useRef();
  const cloudNodesRef = useRef({});
  const [assetReady, setAssetReady] = useState(Boolean(nukeCloudAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(nukeCloudAssetCache.error));

  const cloudScene = useMemo(() => {
    if (!assetReady || !nukeCloudAssetCache.scene) return null;
    const clone = cloneNukeCloudScene(nukeCloudAssetCache.scene);
    cloudNodesRef.current = clone.userData.namedNodes || {};
    return clone;
  }, [assetReady]);

  useEffect(() => {
    let cancelled = false;
    if (!assetReady && !assetFailed) {
      loadNukeCloudAsset()
        .then(() => {
          if (!cancelled) setAssetReady(true);
        })
        .catch(() => {
          if (!cancelled) setAssetFailed(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [assetReady, assetFailed]);

  useEffect(() => {
    return () => {
      if (!cloudScene) return;
      cloudScene.traverse((object) => {
        if (!object.isMesh) return;
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => material?.dispose?.());
        } else {
          object.material?.dispose?.();
        }
      });
    };
  }, [cloudScene]);

  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) {
      if (groupRef.current) groupRef.current.visible = false;
      return;
    }

    const dt = Math.min(delta, 0.05);
    const age = (p.age || 0) + dt * 60;
    p.age = age;

    if (age > NUKE_CLOUD_MAX_AGE) {
      p.dead = true;
      if (groupRef.current) groupRef.current.visible = false;
      return;
    }

    const blastScale = p.scale || NUKE_MUSHROOM_BASE_SCALE;
    const progress = Math.min(1, age / 125);
    const fadeAlpha = age < 160 ? 1 : Math.max(0, 1 - (age - 160) / 50);
    const blastFlash = Math.max(0, 1 - age / 16);
    const ringProgress = Math.min(1, age / 75);
    const emberGlow = Math.max(0, 1 - age / 44);
    const time = state.clock.elapsedTime;
    const rootScale = (0.45 + Math.pow(progress, 0.85) * 4.6) * blastScale;

    if (groupRef.current) {
      groupRef.current.visible = true;
      groupRef.current.position.set(p.x, p.y || 0, p.z);
      groupRef.current.scale.setScalar(rootScale);
      groupRef.current.rotation.y = Math.sin(time * 0.8 + blastScale * 0.7) * 0.035;
    }

    const nodes = cloudNodesRef.current;
    const useFallback = !cloudScene;

    if (!useFallback) {
      const stem = nodes.nuke_stem;
      const plume = nodes.nuke_plume;
      const cap = nodes.nuke_cap;
      const ember = nodes.nuke_ember;
      const ring = nodes.nuke_ring;
      const flash = nodes.nuke_flash;

      applyBaseScale(stem, 0.6 + progress * 1.45, progress * 12);
      setCloudOpacity(stem, fadeAlpha * 0.7);

      applyBaseScale(plume, 0.72 + progress * 1.28, progress * 18);
      plume.rotation.y = time * 0.18;
      setCloudOpacity(plume, fadeAlpha * 0.68);

      applyBaseScale(cap, 0.76 + progress * 1.18, progress * 26);
      cap.rotation.y = -time * 0.12;
      setCloudOpacity(cap, fadeAlpha * 0.84);

      Object.keys(nodes).forEach((name, idx) => {
        if (!name.startsWith('nuke_lobe_')) return;
        const lobe = nodes[name];
        const wobble = Math.sin(time * 1.6 + idx) * 0.05;
        applyBaseScale(lobe, 0.92 + progress * 0.72 + wobble, progress * (18 + idx * 2));
        setCloudOpacity(lobe, fadeAlpha * (0.66 + idx * 0.04));
      });

      applyBaseScale(ember, 0.85 + emberGlow * 2.6, 0);
      setCloudOpacity(ember, fadeAlpha * (0.28 + emberGlow * 0.56));

      applyBaseScale(ring, 0.48 + Math.pow(ringProgress, 0.58) * 11.5, 0);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 6 + Math.pow(ringProgress, 0.5) * 6;
      setCloudOpacity(ring, fadeAlpha * (1 - ringProgress) * 0.42);

      applyBaseScale(flash, 0.8 + blastFlash * 5.5, blastFlash * 10);
      setCloudOpacity(flash, fadeAlpha * blastFlash * 0.75);
    }

    if (fallbackStemRef.current) {
      fallbackStemRef.current.visible = useFallback;
      fallbackStemRef.current.scale.set(0.9 + progress * 1.2, 0.6 + progress * 3.2, 0.9 + progress * 1.2);
      fallbackStemRef.current.position.y = 32 + progress * 92;
      fallbackStemRef.current.material.opacity = fadeAlpha * 0.6;
    }

    if (fallbackCapRef.current) {
      fallbackCapRef.current.visible = useFallback;
      fallbackCapRef.current.scale.set(1.2 + progress * 2.2, 0.7 + progress * 0.8, 1.2 + progress * 2.2);
      fallbackCapRef.current.position.y = 126 + progress * 120;
      fallbackCapRef.current.material.opacity = fadeAlpha * 0.72;
    }

    if (fallbackRingRef.current) {
      fallbackRingRef.current.visible = useFallback;
      fallbackRingRef.current.scale.setScalar(0.6 + Math.pow(ringProgress, 0.58) * 12);
      fallbackRingRef.current.position.y = 2 + ringProgress * 4;
      fallbackRingRef.current.material.opacity = fadeAlpha * (1 - ringProgress) * 0.32;
    }

    if (fallbackFlashRef.current) {
      fallbackFlashRef.current.visible = useFallback && blastFlash > 0.02;
      fallbackFlashRef.current.scale.setScalar(1 + blastFlash * 7.5);
      fallbackFlashRef.current.position.y = 48 + blastFlash * 18;
      fallbackFlashRef.current.material.opacity = fadeAlpha * blastFlash * 0.46;
    }

    if (fallbackEmberRef.current) {
      fallbackEmberRef.current.visible = useFallback && emberGlow > 0.02;
      fallbackEmberRef.current.scale.setScalar(0.9 + emberGlow * 2.8);
      fallbackEmberRef.current.position.y = 22;
      fallbackEmberRef.current.material.opacity = fadeAlpha * emberGlow * 0.54;
    }

    if (lightRef.current) {
      lightRef.current.position.y = (70 + progress * 180) * blastScale;
      lightRef.current.distance = 900 * blastScale;
      lightRef.current.intensity = fadeAlpha * Math.max(0, 42 * blastFlash + 12 * emberGlow);
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {cloudScene ? <primitive object={cloudScene} /> : null}

      <mesh ref={fallbackStemRef} visible={false}>
        <cylinderGeometry args={[9, 18, 70, 8]} />
        <meshBasicMaterial color="#6b7280" transparent opacity={0.6} />
      </mesh>
      <mesh ref={fallbackCapRef} visible={false}>
        <sphereGeometry args={[32, 10, 8]} />
        <meshBasicMaterial color="#cbd5e1" transparent opacity={0.72} />
      </mesh>
      <mesh ref={fallbackRingRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <torusGeometry args={[38, 4.5, 6, 18]} />
        <meshBasicMaterial color="#fed7aa" transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={fallbackFlashRef} visible={false}>
        <sphereGeometry args={[22, 8, 6]} />
        <meshBasicMaterial color="#fff7ed" transparent opacity={0.46} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={fallbackEmberRef} visible={false}>
        <sphereGeometry args={[12, 8, 6]} />
        <meshBasicMaterial color="#fb923c" transparent opacity={0.58} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <pointLight
        ref={lightRef}
        position={[0, 160, 0]}
        color="#ff7a18"
        intensity={0}
        distance={900}
        decay={1.8}
      />
    </group>
  );
});

const EntityMissile = ({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  useFrame((state) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    group.current.position.set(p.x, p.y, p.z);
  });
  return (
    <group ref={group}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[2, 2, 15, 8]} />
        <meshStandardMaterial color="#94a3b8" emissive="#cbd5e1" emissiveIntensity={0.5} />
      </mesh>
      {/* Fire tail */}
      <mesh position={[-10, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[2.5, 8, 8]} />
        <meshBasicMaterial color="#fb923c" />
      </mesh>
    </group>
  );
};

// Missile impact explosion - small but visible
const EntityMissileImpact = ({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const materials = useRef([]);
  const age = useRef(0);
  const pos = useRef(null);

  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    
    if (!pos.current && p.x !== undefined) pos.current = { x: p.x, y: p.y, z: p.z };
    if (!pos.current) return;
    
    age.current += delta;
    if (age.current > 0.5) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }

    const progress = age.current / 0.5;
    const scale = 1 + progress * 3;
    const opacity = 1 - progress;

    if (group.current) {
        group.current.position.set(pos.current.x, pos.current.y, pos.current.z);
        group.current.scale.set(scale, scale, scale);
        group.current.visible = true;
    }
    
    materials.current.forEach(mat => {
        if (!mat) return;
        mat.opacity = mat._origOpacity * opacity;
    });
  });

  return (
    <group ref={group} visible={false}>
      <mesh>
        <sphereGeometry args={[4, 10, 10]} />
        <meshStandardMaterial ref={el => { if(el){ el._origOpacity = 1; materials.current.push(el); } }} color="#ffffff" emissive="#ffffff" emissiveIntensity={5} transparent />
      </mesh>
      <mesh>
        <sphereGeometry args={[8, 8, 8]} />
        <meshStandardMaterial ref={el => { if(el){ el._origOpacity = 0.7; materials.current.push(el); } }} color="#ff6600" emissive="#ff4400" emissiveIntensity={3} transparent />
      </mesh>
      <mesh position={[0, 5, 0]}>
        <sphereGeometry args={[6, 6, 6]} />
        <meshBasicMaterial ref={el => { if(el){ el._origOpacity = 0.4; materials.current.push(el); } }} color="#333333" transparent />
      </mesh>
    </group>
  );
};

const EntityImpactPuff = memo(({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const age = useRef(0);
  const ringRef = useRef();
  const smokeRef = useRef();

  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }

    age.current += delta;
    if (age.current > 0.35) {
      p.dead = true;
      if (group.current) group.current.visible = false;
      return;
    }

    const progress = age.current / 0.35;
    const baseY = getTerrainHeight(p.x, p.z);

    if (group.current) {
      group.current.position.set(p.x, baseY + 0.2, p.z);
      group.current.visible = true;
    }
    if (ringRef.current) {
      const scale = 1 + progress * 5.5;
      ringRef.current.scale.set(scale, scale, 1);
      ringRef.current.material.opacity = 0.45 * (1 - progress);
    }
    if (smokeRef.current) {
      const scale = 1 + progress * 2.8;
      smokeRef.current.position.y = 4 + progress * 14;
      smokeRef.current.scale.set(scale, 0.8 + progress * 1.4, scale);
      smokeRef.current.material.opacity = 0.3 * (1 - progress);
    }
  });

  return (
    <group ref={group} visible={false}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[12, 22, 24]} />
        <meshBasicMaterial color="#d6a77a" transparent opacity={0.45} />
      </mesh>
      <mesh ref={smokeRef} position={[0, 4, 0]}>
        <sphereGeometry args={[10, 12, 10]} />
        <meshBasicMaterial color="#8b7355" transparent opacity={0.3} />
      </mesh>
    </group>
  );
});

const EntityBunker = memo(({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const hpBar = useRef();
  const shellRef = useRef();
  const entryRef = useRef();
  const doorRef = useRef();
  const lightRefs = useRef([]);
  const smokeRefs = useRef([]);
  const structureNodesRef = useRef({});
  const { camera } = useThree();
  const [assetReady, setAssetReady] = useState(Boolean(baseStructuresAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(baseStructuresAssetCache.error));
  const trackedBunker = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  const bunkerDestroyed = trackedBunker ? isBrokenStructure(trackedBunker) || trackedBunker.dead : false;
  const bunkerAssetName = bunkerDestroyed ? BUNKER_BROKEN_STRUCTURE_ASSET_NAME : BUNKER_STRUCTURE_ASSET_NAME;

  const bunkerScene = useMemo(() => {
    if (!assetReady || !baseStructuresAssetCache.scene) return null;
    const clone = cloneNamedGlbGroup(baseStructuresAssetCache.scene, bunkerAssetName);
    structureNodesRef.current = clone?.userData?.namedNodes || {};
    return clone;
  }, [assetReady, bunkerAssetName]);

  useEffect(() => {
    let cancelled = false;
    if (!assetReady && !assetFailed) {
      loadBaseStructuresAsset()
        .then(() => {
          if (!cancelled) setAssetReady(true);
        })
        .catch(() => {
          if (!cancelled) setAssetFailed(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [assetReady, assetFailed]);

  useEffect(() => {
    return () => {
      if (bunkerScene) disposeClonedMaterials(bunkerScene);
    };
  }, [bunkerScene]);

  useFrame((state) => {
    if (hpBar.current) hpBar.current.lookAt(camera.position);
    
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p) { if (group.current) group.current.visible = false; return; }

    const hpRatio = Math.max(0, p.hp / Math.max(1, p.maxHp || BUNKER_BASE_HP));
    const isDestroyed = isBrokenStructure(p) || p.dead;
    const damageStage = isDestroyed ? 3 : hpRatio <= 0.2 ? 3 : hpRatio <= 0.45 ? 2 : hpRatio <= 0.72 ? 1 : 0;
    const recentHit = Math.max(0, 1 - ((Date.now() - (p.lastDamagedAt || 0)) / 420));
    const shake = recentHit > 0 ? Math.sin(state.clock.elapsedTime * 45) * recentHit * 1.35 : 0;
    const structureNodes = structureNodesRef.current || {};
    const shellNode = structureNodes.bunker_shell || shellRef.current;
    const entryNode = structureNodes.bunker_entry || entryRef.current;
    const doorNode = structureNodes.bunker_door || doorRef.current;
    const activeLightRefs = ['bunker_light_0', 'bunker_light_1']
      .map((name) => structureNodes[name])
      .filter(Boolean);
    const animatedLights = activeLightRefs.length ? activeLightRefs : lightRefs.current;
    
    // Sync bunker to terrain height
    if (group.current) {
       p.y = getTerrainHeight(p.x, p.z);
       group.current.position.set(p.x, (p.y || 0) + recentHit * 0.4 - (isDestroyed ? 1.4 : 0), p.z);
       group.current.rotation.z = (isDestroyed ? -0.085 : 0) + shake * 0.005;
       group.current.rotation.x = (isDestroyed ? 0.06 : 0) + recentHit * 0.012;
       group.current.visible = true;
    }

    if (shellNode) {
      shellNode.position.y = isDestroyed ? -2.2 : damageStage >= 2 ? -damageStage * 0.4 : 0;
      shellNode.rotation.x = (isDestroyed ? -0.08 : 0) - recentHit * 0.02;
    }

    if (entryNode) {
      entryNode.position.z = (entryNode.userData.baseZ ?? entryNode.position.z);
      if (entryNode.userData.baseZ === undefined) entryNode.userData.baseZ = entryNode.position.z;
      entryNode.position.z = entryNode.userData.baseZ - damageStage * 0.7;
      entryNode.rotation.x = recentHit * 0.03;
    }

    if (doorNode) {
      if (doorNode.userData.baseX === undefined) {
        doorNode.userData.baseX = doorNode.position.x;
        doorNode.userData.baseZ = doorNode.position.z;
      }
      doorNode.rotation.y = isDestroyed ? -0.6 : damageStage >= 3 ? -0.22 : damageStage >= 2 ? -0.08 : 0;
      doorNode.position.x = doorNode.userData.baseX + (isDestroyed ? -3.2 : damageStage >= 3 ? -1.6 : damageStage >= 2 ? -0.5 : 0);
      doorNode.position.z = doorNode.userData.baseZ + (isDestroyed ? 2.4 : damageStage >= 2 ? 0.6 : 0);
    }

    animatedLights.forEach((light, i) => {
      if (!light || !light.material) return;
      const alertBlink = 0.55 + Math.sin(state.clock.elapsedTime * (damageStage >= 2 ? 12 : 5) + i * 0.7) * 0.45;
      light.material.emissive.set(damageStage >= 2 ? '#ef4444' : damageStage >= 1 ? '#f97316' : '#fb923c');
      light.material.emissiveIntensity = damageStage >= 2 ? 2.2 + alertBlink * 2.2 : damageStage === 1 ? 1.3 + alertBlink * 1.1 : 2.6;
      light.material.color.set(damageStage >= 2 ? '#fca5a5' : damageStage >= 1 ? '#fdba74' : '#f97316');
    });

    smokeRefs.current.forEach((smoke, i) => {
      if (!smoke || !smoke.material) return;
      const active = damageStage >= 1 || isDestroyed;
      smoke.visible = active;
      if (!active) return;
      const drift = (state.clock.elapsedTime * 0.75 + i * 0.55) % 2.6;
      smoke.position.y = smoke.userData.baseY + drift * (damageStage >= 3 ? 5.5 : 3.6);
      smoke.position.x = smoke.userData.baseX + Math.sin(state.clock.elapsedTime * 1.8 + i) * 1.2;
      const scale = smoke.userData.baseScale + drift * 0.45 + damageStage * 0.18;
      smoke.scale.set(scale, scale * (1.2 + damageStage * 0.1), scale);
      smoke.material.opacity = Math.max(0, (damageStage >= 3 ? 0.34 : 0.22) - drift * 0.07);
    });
  });

  const p = trackedBunker;
  if (!p) return null;
  const hpPercent = Math.max(0, p.hp / p.maxHp);
  const isDestroyed = isBrokenStructure(p) || p.dead;
  const isDamaged = hpPercent < 0.72;
  const isCritical = isDestroyed || hpPercent < 0.22;

  return (
    <group ref={group} scale={[1.5, 1.5, 1.5]} position={[p.x, p.y, p.z]}>
      {/* === BURIED VAULT ENTRANCE === */}
      {bunkerScene ? (
        <group>
          <primitive object={bunkerScene} />
          {[[-6, 18, 20], [7, 20, 24], [0, 16, 28]].map((smokePos, i) => (
            <mesh
              key={`vault-smoke-${i}`}
              visible={false}
              ref={(el) => {
                if (el) {
                  el.userData.baseX = smokePos[0];
                  el.userData.baseY = smokePos[1];
                  el.userData.baseScale = 1.3 + i * 0.32;
                  smokeRefs.current[i] = el;
                }
              }}
              position={smokePos}
            >
              <sphereGeometry args={[2.8 + i * 0.6, 8, 8]} />
              <meshBasicMaterial color={isCritical ? '#1f2937' : '#334155'} transparent opacity={0.22} />
            </mesh>
          ))}
          {isDamaged && [[-8, 10, 23], [7, 13, 20], [0, 18, 8]].map((scar, i) => (
            <mesh key={`vault-scar-${i}`} position={scar} rotation={[0.2 + i * 0.1, i * 0.55, 0.12]}>
              <boxGeometry args={[8 + i * 2, 0.6, 1.1]} />
              <meshStandardMaterial color="#3f0d0d" emissive={isCritical ? '#7f1d1d' : '#451a03'} emissiveIntensity={isCritical ? 0.8 : 0.35} roughness={1} />
            </mesh>
          ))}
        </group>
      ) : (
        <group ref={shellRef} position={[0, -2, 0]}>
          <mesh position={[0, 7, -6]} scale={[1.2, 0.82, 1.46]}>
             <sphereGeometry args={[28, 18, 14]} />
             <meshStandardMaterial color={isCritical ? '#3f2a2a' : isDamaged ? '#475569' : '#4b5563'} roughness={0.95} />
          </mesh>
          <mesh position={[0, 15, -14]} scale={[1.45, 0.72, 1.85]}>
             <sphereGeometry args={[18, 18, 12]} />
             <meshStandardMaterial color={isCritical ? '#4b3b31' : isDamaged ? '#4b5563' : '#3f4b36'} roughness={1} />
          </mesh>
          <mesh position={[0, 3, 10]}>
             <boxGeometry args={[42, 8, 54]} />
             <meshStandardMaterial color={isCritical ? '#3f3f46' : '#4b5563'} roughness={0.92} />
          </mesh>
          <mesh position={[0, 11, 22]}>
             <boxGeometry args={[28, 18, 26]} />
             <meshStandardMaterial color={isCritical ? '#4b5563' : '#5b6570'} roughness={0.84} />
          </mesh>
          <mesh position={[0, 12, 31]}>
             <boxGeometry args={[24, 22, 7]} />
             <meshStandardMaterial color="#23272f" roughness={0.9} />
          </mesh>
          <mesh position={[0, 5, 34]}>
             <boxGeometry args={[18, 6, 12]} />
             <meshStandardMaterial color={isCritical ? '#3f1d1d' : '#303845'} roughness={0.9} />
          </mesh>
          {[[-16, 12, 18], [16, 12, 18]].map((buttress, i) => (
            <mesh key={`vault-buttress-${i}`} position={buttress} rotation={[0.24, 0, 0]}>
               <boxGeometry args={[7, 22, 18]} />
               <meshStandardMaterial color={isCritical ? '#4b5563' : '#4b5563'} roughness={0.92} />
            </mesh>
          ))}

          <group ref={entryRef} position={[0, 12, 34.5]}>
            <mesh ref={doorRef} rotation={[Math.PI / 2, 0, 0]}>
               <cylinderGeometry args={[10.5, 10.5, 4, 32]} />
               <meshStandardMaterial color={isCritical ? '#64748b' : '#94a3b8'} metalness={0.86} roughness={0.26} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 1.4]}>
               <cylinderGeometry args={[8.6, 8.6, 2.2, 24]} />
               <meshStandardMaterial color="#475569" metalness={0.78} roughness={0.34} />
            </mesh>
            {[0, 1, 2, 3, 4, 5].map(i => (
               <mesh key={`vault-spoke-${i}`} rotation={[0, 0, (i * Math.PI) / 3]} position={[0, 0, 1.9]}>
                  <boxGeometry args={[17, 1.6, 1.8]} />
                  <meshStandardMaterial color="#64748b" metalness={0.82} roughness={0.34} />
               </mesh>
            ))}
            <mesh position={[0, 0, 2.3]}>
               <sphereGeometry args={[2.7, 12, 12]} />
               <meshStandardMaterial color="#e2e8f0" metalness={0.84} roughness={0.2} />
            </mesh>
          </group>

          <mesh position={[0, 25, 21]}>
             <boxGeometry args={[30, 2.8, 8]} />
             <meshStandardMaterial color="#374151" roughness={0.76} metalness={0.2} />
          </mesh>
          {[[-8, 27, 22], [8, 27, 22]].map((light, i) => (
            <mesh key={`vault-light-${i}`} position={light} ref={(el) => { lightRefs.current[i] = el; }}>
               <cylinderGeometry args={[1.2, 1.2, 2.8]} />
               <meshStandardMaterial color="#f97316" emissive="#fb923c" emissiveIntensity={2.6} />
            </mesh>
          ))}
          {[[-10, 9, 36], [10, 9, 36]].map((rail, i) => (
            <mesh key={`vault-rail-${i}`} position={rail}>
               <boxGeometry args={[2, 8, 2]} />
               <meshStandardMaterial color="#9ca3af" metalness={0.52} roughness={0.34} />
            </mesh>
          ))}
          <mesh position={[0, 13, 38]}>
             <boxGeometry args={[20, 1, 3]} />
             <meshStandardMaterial color="#9ca3af" metalness={0.5} roughness={0.38} />
          </mesh>
          {[[-6, 18, 20], [7, 20, 24], [0, 16, 28]].map((smokePos, i) => (
            <mesh
              key={`vault-smoke-${i}`}
              visible={false}
              ref={(el) => {
                if (el) {
                  el.userData.baseX = smokePos[0];
                  el.userData.baseY = smokePos[1];
                  el.userData.baseScale = 1.3 + i * 0.32;
                  smokeRefs.current[i] = el;
                }
              }}
              position={smokePos}
            >
              <sphereGeometry args={[2.8 + i * 0.6, 8, 8]} />
              <meshBasicMaterial color={isCritical ? '#1f2937' : '#334155'} transparent opacity={0.22} />
            </mesh>
          ))}
          {isDamaged && [[-8, 6, 31], [7, 9, 29], [0, 14, 18]].map((scar, i) => (
            <mesh key={`vault-scar-${i}`} position={scar} rotation={[0.2 + i * 0.1, i * 0.55, 0.12]}>
               <boxGeometry args={[8 + i * 2, 0.6, 0.9]} />
               <meshStandardMaterial color="#3f0d0d" emissive={isCritical ? '#7f1d1d' : '#451a03'} emissiveIntensity={isCritical ? 0.8 : 0.35} roughness={1} />
            </mesh>
          ))}
        </group>
      )}

      {/* HP Bar */}
      {!isDestroyed && (
        <group ref={hpBar} position={[0, 45, 0]}>
           <mesh position={[0, 0, -0.1]}>
              <planeGeometry args={[24, 3]} />
              <meshBasicMaterial color="#7f1d1d" />
           </mesh>
           <mesh position={[12 * (hpPercent - 1), 0, 0]}>
              <planeGeometry args={[24 * hpPercent, 3]} />
              <meshBasicMaterial color="#3b82f6" />
           </mesh>
        </group>
      )}
      {isDestroyed && (
        <group>
          <mesh position={[0, 4.5, 26]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[18, 18]} />
            <meshBasicMaterial color="#1f2937" transparent opacity={0.38} />
          </mesh>
          {[[-8, 7, 22], [7, 9, 18], [0, 5, 28]].map((debris, i) => (
            <mesh key={`vault-debris-${i}`} position={debris} rotation={[0.2 + i * 0.2, i * 0.5, 0.3]}>
              <boxGeometry args={[5 + i * 2, 2.4, 4 + i]} />
              <meshStandardMaterial color="#374151" roughness={0.96} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
});

const EntityFacility = memo(({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const dishRef = useRef();
  const radarDishRef = useRef();
  const aaTurretRef = useRef();
  const aaBarrelRef = useRef();
  const scaffoldRef = useRef();
  const smokeRefs = useRef([]);
  const structureNodesRef = useRef({});
  const [assetReady, setAssetReady] = useState(Boolean(baseStructuresAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(baseStructuresAssetCache.error));
  const trackedFacility = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  const facilityDestroyed = trackedFacility ? isBrokenStructure(trackedFacility) || trackedFacility.dead : false;

  const p = trackedFacility;
  const facilityAssetName = p
    ? facilityDestroyed
      ? FACILITY_BROKEN_STRUCTURE_ASSET_NAMES[p.kind]
      : FACILITY_STRUCTURE_ASSET_NAMES[p.kind]
    : null;
  const facilityScene = useMemo(() => {
    if (!assetReady || !baseStructuresAssetCache.scene || !facilityAssetName) return null;
    const clone = cloneNamedGlbGroup(baseStructuresAssetCache.scene, facilityAssetName);
    structureNodesRef.current = clone?.userData?.namedNodes || {};
    return clone;
  }, [assetReady, facilityAssetName]);

  useEffect(() => {
    let cancelled = false;
    if (!assetReady && !assetFailed) {
      loadBaseStructuresAsset()
        .then(() => {
          if (!cancelled) setAssetReady(true);
        })
        .catch(() => {
          if (!cancelled) setAssetFailed(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [assetReady, assetFailed]);

  useEffect(() => {
    return () => {
      if (facilityScene) disposeClonedMaterials(facilityScene);
    };
  }, [facilityScene]);

  useFrame((state) => {
    const current = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!current || (current.dead && !isBrokenStructure(current))) {
      if (group.current) group.current.visible = false;
      return;
    }
    const destroyed = isBrokenStructure(current) || current.dead;
    const hpRatio = Math.max(0, (current.hp ?? 0) / Math.max(1, current.maxHp || 1000));
    const structureNodes = structureNodesRef.current || {};
    const animatedDish = structureNodes.facility_tech_lab_dish || dishRef.current;
    const animatedRadarDish = structureNodes.facility_radar_tower_dish || radarDishRef.current;
    const animatedTurret = structureNodes.facility_aa_site_turret || aaTurretRef.current;
    const animatedBarrel = structureNodes.facility_aa_site_barrel || aaBarrelRef.current;
    if (group.current) {
      current.y = getTerrainHeight(current.x, current.z);
      group.current.position.set(current.x, current.y - (destroyed ? 1.1 : 0), current.z);
      group.current.rotation.y = current.rotation || 0;
      group.current.rotation.z = destroyed ? -0.055 : 0;
      group.current.rotation.x = destroyed ? 0.028 : 0;
      group.current.visible = true;
    }
    if (animatedDish && current.kind === 'tech_lab' && !current.constructing && !destroyed) {
      animatedDish.rotation.y += 0.02;
      animatedDish.rotation.z = Math.sin(state.clock.elapsedTime * 1.5) * 0.22;
    }
    if (animatedRadarDish && current.kind === 'radar_tower' && !current.constructing && !destroyed) {
      animatedRadarDish.rotation.y += 0.03;
      animatedRadarDish.rotation.x = Math.sin(state.clock.elapsedTime * 1.8) * 0.08;
    }
    if (animatedTurret && current.kind === 'aa_site' && !current.constructing && !destroyed) {
      const localYaw = (current.turretYaw || 0) - (current.rotation || 0);
      animatedTurret.rotation.y = THREE.MathUtils.lerp(animatedTurret.rotation.y, localYaw, 0.22);
    }
    if (animatedBarrel && current.kind === 'aa_site' && !current.constructing && !destroyed) {
      const recoil = current.reloadTimer ? Math.min(1, current.reloadTimer / AA_SITE_RELOAD_TIME) : 0;
      if (animatedBarrel.userData.baseZ === undefined) animatedBarrel.userData.baseZ = animatedBarrel.position.z;
      animatedBarrel.position.z = animatedBarrel.userData.baseZ + recoil * 1.3;
    }
    if (scaffoldRef.current && current.constructing && !destroyed) {
      scaffoldRef.current.rotation.y += 0.01;
    }
    smokeRefs.current.forEach((smoke, i) => {
      if (!smoke || !smoke.material) return;
      const active = destroyed || (!current.constructing && hpRatio < 0.64);
      smoke.visible = active;
      if (!active) return;
      const drift = (state.clock.elapsedTime * 0.72 + i * 0.5) % 2.8;
      smoke.position.y = smoke.userData.baseY + drift * (destroyed ? 5.8 : 3.2);
      smoke.position.x = smoke.userData.baseX + Math.sin(state.clock.elapsedTime * 1.5 + i) * 1.2;
      const scale = smoke.userData.baseScale + drift * 0.48 + (destroyed ? 0.6 : 0.2);
      smoke.scale.set(scale, scale * (destroyed ? 1.35 : 1.15), scale);
      smoke.material.opacity = Math.max(0, (destroyed ? 0.32 : 0.18) - drift * 0.06);
    });
  });

  if (!p) return null;
  const isPowerplant = p.kind === 'powerplant';
  const isFactory = p.kind === 'war_factory';
  const isHospital = p.kind === 'field_hospital';
  const isLab = p.kind === 'tech_lab';
  const isRadar = p.kind === 'radar_tower';
  const isAA = p.kind === 'aa_site';
  const hpPercent = Math.max(0, (p.hp ?? 0) / Math.max(1, p.maxHp || 1000));
  const isDestroyed = isBrokenStructure(p) || p.dead;
  const buildProgress = THREE.MathUtils.clamp(p.buildProgress ?? 1, 0, 1);
  const isConstructing = !!p.constructing && !isDestroyed;
  const constructionScale = isConstructing ? 0.68 + buildProgress * 0.32 : 1;
  const constructionLift = isConstructing ? (1 - buildProgress) * 14 : 0;

  const visualScale = p.visualScale || 1.45;

  return (
    <group ref={group} position={[p.x, p.y, p.z]} scale={[visualScale, visualScale, visualScale]}>
      <group position={[0, constructionLift, 0]} scale={[constructionScale, constructionScale, constructionScale]}>
      {facilityScene ? (
        <primitive object={facilityScene} />
      ) : (
        <>
          {isPowerplant && (
            <group>
              <mesh position={[0, 8, 0]}>
                <boxGeometry args={[34, 16, 28]} />
                <meshStandardMaterial color="#334155" roughness={0.8} metalness={0.3} />
              </mesh>
              <mesh position={[0, 20, -10]}>
                <boxGeometry args={[36, 4, 10]} />
                <meshStandardMaterial color="#475569" roughness={0.68} metalness={0.34} />
              </mesh>
              <mesh position={[0, 4, 18]}>
                <cylinderGeometry args={[18, 19, 4, 18]} />
                <meshStandardMaterial color="#111827" roughness={0.9} metalness={0.18} />
              </mesh>
              {[[-8, 20, -4], [8, 20, -4]].map((stack, idx) => (
                <mesh key={`plant-stack-${idx}`} position={stack}>
                  <cylinderGeometry args={[2.6, 3.2, 22, 12]} />
                  <meshStandardMaterial color="#475569" roughness={0.72} metalness={0.28} />
                </mesh>
              ))}
              {[[-14, 14, 9], [14, 14, 9]].map((tank, idx) => (
                <mesh key={`plant-tank-${idx}`} position={tank}>
                  <cylinderGeometry args={[5.2, 5.2, 12, 14]} />
                  <meshStandardMaterial color="#64748b" roughness={0.6} metalness={0.38} />
                </mesh>
              ))}
              <mesh position={[0, 18, 8]}>
                <boxGeometry args={[26, 6, 10]} />
                <meshStandardMaterial color="#1f2937" roughness={0.76} metalness={0.32} />
              </mesh>
              <pointLight position={[0, 18, 11]} color="#f59e0b" intensity={2.1} distance={120} />
            </group>
          )}
          {isFactory && (
            <group>
              <mesh position={[0, 10, 0]}>
                <boxGeometry args={[44, 20, 34]} />
                <meshStandardMaterial color="#374151" roughness={0.84} metalness={0.26} />
              </mesh>
              <mesh position={[0, 14, 20]}>
                <boxGeometry args={[24, 18, 6]} />
                <meshStandardMaterial color="#0f172a" roughness={0.56} metalness={0.56} />
              </mesh>
              <mesh position={[0, 8, 17]}>
                <boxGeometry args={[18, 11, 2]} />
                <meshStandardMaterial color="#111827" roughness={0.62} metalness={0.52} />
              </mesh>
              <mesh position={[0, 22, -8]}>
                <boxGeometry args={[32, 4, 14]} />
                <meshStandardMaterial color="#475569" roughness={0.7} metalness={0.28} />
              </mesh>
              <mesh position={[0, 25, -8]}>
                <boxGeometry args={[22, 2, 8]} />
                <meshStandardMaterial color="#0f172a" roughness={0.58} metalness={0.5} />
              </mesh>
              {[[-17, 20, -8], [17, 20, -8]].map((stack, idx) => (
                <mesh key={`factory-stack-${idx}`} position={stack}>
                  <boxGeometry args={[5, 14, 5]} />
                  <meshStandardMaterial color="#1f2937" roughness={0.72} metalness={0.34} />
                </mesh>
              ))}
              {[[-18, 5, -12], [18, 5, -12]].map((track, idx) => (
                <mesh key={`factory-track-${idx}`} position={track}>
                  <boxGeometry args={[8, 2.6, 18]} />
                  <meshStandardMaterial color="#4b5563" roughness={0.82} metalness={0.24} />
                </mesh>
              ))}
            </group>
          )}
          {isHospital && (
            <group>
              <mesh position={[0, 8, 0]}>
                <boxGeometry args={[34, 16, 30]} />
                <meshStandardMaterial color="#dbeafe" roughness={0.84} metalness={0.18} />
              </mesh>
              <mesh position={[0, 12, 18]}>
                <boxGeometry args={[30, 10, 8]} />
                <meshStandardMaterial color="#f8fafc" roughness={0.78} metalness={0.12} />
              </mesh>
              <mesh position={[0, 17, 0]}>
                <boxGeometry args={[16, 4, 12]} />
                <meshStandardMaterial color="#1e293b" roughness={0.72} metalness={0.22} />
              </mesh>
              <mesh position={[0, 19.5, 15]}>
                <boxGeometry args={[8, 8, 2.4]} />
                <meshStandardMaterial color="#ef4444" roughness={0.6} metalness={0.12} />
              </mesh>
              <mesh position={[0, 19.5, 15]}>
                <boxGeometry args={[2.4, 8, 8]} />
                <meshStandardMaterial color="#ef4444" roughness={0.6} metalness={0.12} />
              </mesh>
              {[[-10, 15, -6], [10, 15, -6]].map((pad, idx) => (
                <mesh key={`med-pad-${idx}`} position={pad}>
                  <cylinderGeometry args={[4, 4.8, 2.6, 12]} />
                  <meshStandardMaterial color="#93c5fd" roughness={0.68} metalness={0.16} />
                </mesh>
              ))}
              {[[-18, 6, -12], [18, 6, -12]].map((tent, idx) => (
                <mesh key={`med-tent-${idx}`} position={tent} rotation={[0, idx === 0 ? -0.18 : 0.18, 0]}>
                  <boxGeometry args={[10, 8, 14]} />
                  <meshStandardMaterial color="#cbd5e1" roughness={0.92} metalness={0.06} />
                </mesh>
              ))}
            </group>
          )}
          {isLab && (
            <group>
              <mesh position={[0, 10, 0]}>
                <cylinderGeometry args={[12, 14, 20, 16]} />
                <meshStandardMaterial color="#1e293b" roughness={0.72} metalness={0.34} />
              </mesh>
              <mesh position={[0, 8, 18]}>
                <boxGeometry args={[24, 14, 10]} />
                <meshStandardMaterial color="#0f172a" roughness={0.58} metalness={0.52} />
              </mesh>
              <mesh position={[0, 24, 0]}>
                <cylinderGeometry args={[7, 8, 9, 16]} />
                <meshStandardMaterial color="#334155" roughness={0.65} metalness={0.36} />
              </mesh>
              <mesh position={[0, 39, 0]}>
                <cylinderGeometry args={[2.6, 3.4, 18, 12]} />
                <meshStandardMaterial color="#64748b" roughness={0.48} metalness={0.62} />
              </mesh>
              <group ref={dishRef} position={[0, 31, 0]}>
                <mesh rotation={[-Math.PI / 2.8, 0, 0]}>
                  <cylinderGeometry args={[0.5, 7.8, 4.2, 24, 1, true]} />
                  <meshStandardMaterial color="#cbd5e1" roughness={0.26} metalness={0.82} side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, 0, -2.8]}>
                  <sphereGeometry args={[1.8, 12, 12]} />
                  <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={1.3} />
                </mesh>
              </group>
            </group>
          )}
          {isRadar && (
            <group>
              <mesh position={[0, 7, 0]}>
                <cylinderGeometry args={[11, 14, 14, 16]} />
                <meshStandardMaterial color="#1f2937" roughness={0.8} metalness={0.28} />
              </mesh>
              {[[-8, 17, -8], [8, 17, -8], [-8, 17, 8], [8, 17, 8]].map((brace, idx) => (
                <mesh key={`radar-brace-${idx}`} position={brace} rotation={[0, 0, idx < 2 ? -0.14 : 0.14]}>
                  <boxGeometry args={[2, 22, 2]} />
                  <meshStandardMaterial color="#94a3b8" roughness={0.48} metalness={0.56} />
                </mesh>
              ))}
              <mesh position={[0, 24, 0]}>
                <cylinderGeometry args={[2.4, 3.2, 34, 12]} />
                <meshStandardMaterial color="#94a3b8" roughness={0.45} metalness={0.58} />
              </mesh>
              <mesh position={[0, 43, 0]}>
                <sphereGeometry args={[5.6, 16, 16]} />
                <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.8} roughness={0.28} metalness={0.46} />
              </mesh>
              <mesh ref={radarDishRef} position={[0, 31, 0]} rotation={[0, 0, 0]}>
                <torusGeometry args={[11, 0.9, 8, 24]} />
                <meshStandardMaterial color="#cbd5e1" roughness={0.34} metalness={0.72} />
              </mesh>
            </group>
          )}
          {isAA && (
            <group>
              <mesh position={[0, 8, 0]}>
                <cylinderGeometry args={[15, 18, 16, 10]} />
                <meshStandardMaterial color="#1f2937" roughness={0.86} metalness={0.24} />
              </mesh>
              <mesh position={[0, 4, 0]}>
                <cylinderGeometry args={[23, 25, 4, 18]} />
                <meshStandardMaterial color="#111827" roughness={0.92} metalness={0.18} />
              </mesh>
              <mesh position={[0, 16, 0]}>
                <cylinderGeometry args={[9, 11, 6, 12]} />
                <meshStandardMaterial color="#334155" roughness={0.7} metalness={0.34} />
              </mesh>
              <group ref={aaTurretRef} position={[0, 20, 0]}>
                <mesh>
                  <boxGeometry args={[15, 5, 10]} />
                  <meshStandardMaterial color="#0f172a" roughness={0.56} metalness={0.55} />
                </mesh>
                <mesh ref={aaBarrelRef} position={[0, 1, 6]}>
                  <boxGeometry args={[5.5, 1.1, 10.5]} />
                  <meshStandardMaterial color="#475569" roughness={0.44} metalness={0.66} />
                </mesh>
                <mesh position={[-3.2, 0.4, 6]}>
                  <cylinderGeometry args={[0.65, 0.65, 9.4, 8]} />
                  <meshStandardMaterial color="#64748b" roughness={0.4} metalness={0.72} />
                </mesh>
                <mesh position={[3.2, 0.4, 6]}>
                  <cylinderGeometry args={[0.65, 0.65, 9.4, 8]} />
                  <meshStandardMaterial color="#64748b" roughness={0.4} metalness={0.72} />
                </mesh>
                <mesh position={[0, 1.4, -3.4]}>
                  <boxGeometry args={[3.6, 2.2, 2.1]} />
                  <meshStandardMaterial color="#111827" emissive="#22d3ee" emissiveIntensity={0.35} />
                </mesh>
              </group>
              <mesh position={[0, 1.6, 0]}>
                <cylinderGeometry args={[19, 19, 1.6, 20]} />
                <meshStandardMaterial color="#0b1324" roughness={0.95} />
              </mesh>
            </group>
          )}
        </>
      )}
      </group>
      {[[-8, 18, 10], [10, 22, -8], [0, 26, 2]].map((smokePos, i) => (
        <mesh
          key={`facility-smoke-${i}`}
          visible={false}
          ref={(el) => {
            if (el) {
              el.userData.baseX = smokePos[0];
              el.userData.baseY = smokePos[1];
              el.userData.baseScale = 1.8 + i * 0.36;
              smokeRefs.current[i] = el;
            }
          }}
          position={smokePos}
        >
          <sphereGeometry args={[3.2 + i * 0.7, 8, 8]} />
          <meshBasicMaterial color={isDestroyed ? '#1f2937' : '#334155'} transparent opacity={0.2} />
        </mesh>
      ))}
      {isDestroyed && (
        <group>
          <mesh position={[0, 0.8, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[26, 20]} />
            <meshBasicMaterial color="#0f1720" transparent opacity={0.34} />
          </mesh>
          <mesh position={[0, 0.95, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[17, 18]} />
            <meshBasicMaterial color="#3f1a10" transparent opacity={0.22} />
          </mesh>
          {[[-12, 2.4, 10], [11, 2.8, -9], [0, 2.1, 16]].map((debris, i) => (
            <mesh key={`facility-debris-${i}`} position={debris} rotation={[0.18 + i * 0.1, i * 0.45, 0.24]}>
              <boxGeometry args={[7 + i * 2.5, 2.8 + i * 0.4, 5 + i]} />
              <meshStandardMaterial color={i === 1 ? '#475569' : '#374151'} roughness={0.96} metalness={i === 1 ? 0.22 : 0.08} />
            </mesh>
          ))}
        </group>
      )}
      {isConstructing && (
        <group>
          <group ref={scaffoldRef} position={[0, 10, 0]}>
            <mesh>
              <cylinderGeometry args={[22, 22, 1.6, 16]} />
              <meshBasicMaterial color="#14532d" transparent opacity={0.2} />
            </mesh>
            {[0, 1, 2, 3].map((idx) => (
              <mesh
                key={`scaffold-post-${idx}`}
                position={[
                  Math.cos((idx / 4) * Math.PI * 2) * 14,
                  10,
                  Math.sin((idx / 4) * Math.PI * 2) * 14
                ]}
              >
                <cylinderGeometry args={[0.9, 0.9, 20, 6]} />
                <meshBasicMaterial color="#86efac" transparent opacity={0.28} />
              </mesh>
            ))}
          </group>
          <group position={[0, 34, 0]}>
            <mesh position={[0, 0, -0.1]}>
              <planeGeometry args={[26, 2.2]} />
              <meshBasicMaterial color="#064e3b" transparent opacity={0.65} />
            </mesh>
            <mesh position={[13 * (buildProgress - 1), 0, 0]}>
              <planeGeometry args={[26 * buildProgress, 2.2]} />
              <meshBasicMaterial color="#22c55e" transparent opacity={0.92} />
            </mesh>
          </group>
        </group>
      )}
    </group>
  );
});

const EntityBarricade = memo(({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const hpBar = useRef();
  const { camera } = useThree();

  useFrame(() => {
    if (hpBar.current) hpBar.current.lookAt(camera.position);
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) {
      if (group.current) group.current.visible = false;
      return;
    }
    if (group.current) {
      p.y = getTerrainHeight(p.x, p.z);
      group.current.position.set(p.x, p.y, p.z);
      group.current.rotation.y = -p.rotation + Math.PI / 2;
    }
  });

  const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  if (!p || p.dead) return null;
  const hpPercent = Math.max(0, p.hp / p.maxHp);
  const expiredRatio = THREE.MathUtils.clamp((p.expiresAt - Date.now()) / BARRICADE_LIFETIME_MS, 0, 1);

  return (
    <group ref={group} position={[p.x, p.y, p.z]}>
      {[[-18, 0], [0, 0], [18, 0]].map(([x, z], idx) => (
        <group key={`barrier-seg-${idx}`} position={[x, 0, z]}>
          <mesh position={[0, 10, 0]}>
            <boxGeometry args={[12, 18, 6]} />
            <meshStandardMaterial color="#4b5563" roughness={0.92} metalness={0.14} />
          </mesh>
          <mesh position={[0, 3, 0]}>
            <boxGeometry args={[15, 4, 8]} />
            <meshStandardMaterial color="#292524" roughness={0.98} />
          </mesh>
          <mesh position={[0, 18, 0]}>
            <boxGeometry args={[15, 2, 2]} />
            <meshStandardMaterial color="#9a3412" emissive="#b45309" emissiveIntensity={0.25 + (1 - expiredRatio) * 0.18} />
          </mesh>
        </group>
      ))}
      {[[-26, 5], [26, 5]].map((post, idx) => (
        <mesh key={`barrier-post-${idx}`} position={[post[0], 8, post[1]]}>
          <cylinderGeometry args={[1.4, 1.6, 16, 8]} />
          <meshStandardMaterial color="#78716c" roughness={0.84} metalness={0.22} />
        </mesh>
      ))}
      <group ref={hpBar} position={[0, 26, 0]}>
        <mesh position={[0, 0, -0.1]}>
          <planeGeometry args={[18, 2]} />
          <meshBasicMaterial color="#450a0a" />
        </mesh>
        <mesh position={[9 * (hpPercent - 1), 0, 0]}>
          <planeGeometry args={[18 * hpPercent, 2]} />
          <meshBasicMaterial color={expiredRatio < 0.25 ? '#f97316' : '#22c55e'} />
        </mesh>
      </group>
    </group>
  );
});

const EntityKaiju = ({ entityId, index, entitiesRef, entityLookupRef, frameSnapshotRef, setGameState }) => {
  const group = useRef();
  const hpBar = useRef();
  const jawRef = useRef();
  const kaijuNodesRef = useRef({});
  const spiderRootRef = useRef();
  const spiderAbdomenRef = useRef();
  const spiderThoraxRef = useRef();
  const spiderHeadRef = useRef();
  const spiderPedipalpRefs = useRef([]);
  const spiderLegRefs = useRef([]);
  const birdRootRef = useRef();
  const birdLeftWingRef = useRef();
  const birdRightWingRef = useRef();
  const birdTailRef = useRef();
  const birdHeadRef = useRef();
  const { camera } = useThree();
  const spiderLegConfigs = useMemo(() => {
    const anchorZ = [9, 3, -4, -12];
    const stride = [0.32, 0.12, -0.1, -0.26];
    const lift = [0.22, 0.16, 0.18, 0.14];
    return anchorZ.flatMap((z, row) => ([
      {
        side: -1,
        phase: row % 2 === 0 ? 0 : Math.PI,
        anchor: [-8.2 + row * 0.2, 9.6 - row * 0.3, z],
        yaw: -0.3 + row * 0.18,
        splay: 1.12 - row * 0.12,
        stride: stride[row],
        lift: lift[row]
      },
      {
        side: 1,
        phase: row % 2 === 0 ? Math.PI : 0,
        anchor: [8.2 - row * 0.2, 9.6 - row * 0.3, z],
        yaw: 0.3 - row * 0.18,
        splay: 1.12 - row * 0.12,
        stride: -stride[row],
        lift: lift[row]
      }
    ]));
  }, []);
  const registerSpiderLegPart = (index, part) => (el) => {
    if (!spiderLegRefs.current[index]) spiderLegRefs.current[index] = {};
    spiderLegRefs.current[index][part] = el;
  };
  const registerSpiderPedipalp = (index) => (el) => {
    spiderPedipalpRefs.current[index] = el;
  };
  const initialKaiju = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  const [assetReady, setAssetReady] = useState(Boolean(kaijuAssetsAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(kaijuAssetsAssetCache.error));
  const kaijuAssetName = initialKaiju ? KAIJU_STRUCTURE_ASSET_NAMES[initialKaiju.variant] : null;
  const kaijuScene = useMemo(() => {
    if (!assetReady || !kaijuAssetsAssetCache.scene || !kaijuAssetName) return null;
    const clone = cloneNamedGlbGroup(kaijuAssetsAssetCache.scene, kaijuAssetName);
    kaijuNodesRef.current = clone?.userData?.namedNodes || {};
    return clone;
  }, [assetReady, kaijuAssetName]);

  useEffect(() => {
    let cancelled = false;
    if (!assetReady && !assetFailed) {
      loadKaijuAssetsAsset()
        .then(() => {
          if (!cancelled) setAssetReady(true);
        })
        .catch(() => {
          if (!cancelled) setAssetFailed(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [assetReady, assetFailed]);

  useEffect(() => {
    const nodes = kaijuScene?.userData?.namedNodes || {};
    jawRef.current = nodes.kaiju_godzilla_jaw || nodes.kaiju_beetle_jaw || nodes.kaiju_wyrm_jaw || null;
    spiderRootRef.current = nodes.kaiju_spider_root || null;
    spiderAbdomenRef.current = nodes.kaiju_spider_abdomen || null;
    spiderThoraxRef.current = nodes.kaiju_spider_thorax || null;
    spiderHeadRef.current = nodes.kaiju_spider_head || null;
    spiderPedipalpRefs.current = [
      nodes.kaiju_spider_pedipalp_0 || null,
      nodes.kaiju_spider_pedipalp_1 || null
    ];
    spiderLegRefs.current = spiderLegConfigs.map((_, index) => ({
      upper: nodes[`kaiju_spider_leg_${index}_upper`] || null,
      mid: nodes[`kaiju_spider_leg_${index}_mid`] || null,
      lower: nodes[`kaiju_spider_leg_${index}_lower`] || null
    }));
    birdRootRef.current = nodes.kaiju_bird_root || null;
    birdLeftWingRef.current = nodes.kaiju_bird_left_wing || null;
    birdRightWingRef.current = nodes.kaiju_bird_right_wing || null;
    birdTailRef.current = nodes.kaiju_bird_tail || null;
    birdHeadRef.current = nodes.kaiju_bird_head || null;

    return () => {
      if (kaijuScene) disposeClonedMaterials(kaijuScene);
    };
  }, [kaijuScene, spiderLegConfigs]);

  useFrame((state, delta) => {
    // Force render update
    
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p) {
       if (group.current) group.current.visible = false;
       return;
    }
    if (p.dead) { 
       if (group.current) group.current.visible = false; 
       return; 
    }
    if (!group.current) return;

    const now = state.clock.elapsedTime;
    if ((p.hp || 0) <= 0 && p.state !== 'dying' && p.state !== 'dead') {
      markKaijuDefeated(p);
    }
    const frameSnapshot = frameSnapshotRef?.current;
    const hpRatio = Math.max(0, p.hp / p.maxHp);
    const damageStageLive = hpRatio <= 0.2 ? 3 : hpRatio <= 0.45 ? 2 : hpRatio <= 0.7 ? 1 : 0;
    const isFlyingVariant = isFlyingKaijuVariant(p.variant);
    const variantTuning = getKaijuVariantTuning(p.variant);
    const frameStep = getFrameScaledStep(delta);
    const baseScale = p.scale || 10;

    if (p.state === 'dying') {
      p.vx = 0;
      p.vz = 0;
      if (!Number.isFinite(p.y)) {
        p.y = isFlyingVariant ? (p.flightBaseHeight || getTerrainHeight(p.x, p.z) + 80) : getTerrainHeight(p.x, p.z);
      }
      group.current.position.set(p.x, p.y, p.z);
      group.current.rotation.y = p.rotation ?? group.current.rotation.y;
      group.current.position.y -= (delta || 0.016) * 30;
      group.current.rotation.x -= (delta || 0.016) * 1.5;
      if (jawRef.current) jawRef.current.rotation.x = Math.PI / 4;
      group.current.scale.set(baseScale, baseScale, baseScale);

      if (group.current.position.y < -baseScale * 2) {
        if (!p.deathRemainsSpawned) {
          pushScorchEntity(entitiesRef.current, p.x, p.z, Math.max(70, baseScale * 18));
          entitiesRef.current.push(createKaijuCorpseEntity(p));
          p.deathRemainsSpawned = true;
        }
        p.state = 'dead';
        p.dead = true;
        group.current.visible = false;
      }
      return;
    }
    
    // Kaiju passively crushes nearby entities
    if (!p.nextCollateralAt) {
      p.nextCollateralAt = now;
    }
    if (!isFlyingVariant && now >= p.nextCollateralAt) {
      applyKaijuCollateralDamage(
        entitiesRef.current,
        p,
        200,
        frameSnapshot?.collateralTargets || entitiesRef.current
      );
      p.nextCollateralAt = now + KAIJU_COLLATERAL_DAMAGE_INTERVAL;
    }
    
    // Spawn airforce jets ONLY IF nukeCount > 0 (user has started interacting)
    if (Math.random() < 0.002 && (window._nukeInteractionTriggered)) {
        const jets = frameSnapshot?.liveJets || entitiesRef.current.filter(e => e.type === 'jet' && !e.dead);
        if (jets.length < 3) {
            const fromLeft = Math.random() > 0.5;
            const targetKaiju = p; // Current kaiju
            entitiesRef.current.push({
                id: `jet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                type: 'jet',
                x: fromLeft ? -WORLD_WIDTH/2 - 100 : WORLD_WIDTH/2 + 100,
                y: 200 + Math.random() * 100,
                z: p.z + (Math.random() - 0.5) * 200,
                vx: fromLeft ? 8 : -8,
                vz: 0,
                targetKaiju: { x: targetKaiju.x, y: targetKaiju.y, z: targetKaiju.z },
                fired: false,
                dead: false
            });
            AudioManager.play('plane_engine', { volume: 0.1, duration: 0.3 });
        }
    }
    
    // === AVOID OVERLAPPING: Simple repulsion force between kaijus ===
    const otherKaijus = (frameSnapshot?.aliveKaijus || entitiesRef.current).filter(e => e.type === 'kaiju' && e.id !== p.id && !isKaijuDefeated(e));
    const minSeparation = 180; 
    otherKaijus.forEach(other => {
       const dx = p.x - other.x;
       const dz = p.z - other.z;
        const d = Math.sqrt(dx*dx + dz*dz);
        if (d > 0 && d < minSeparation) {
          const force = (minSeparation - d) * 0.05 * frameStep;
          p.x += (dx / d) * force;
          p.z += (dz / d) * force;
        }
    });

    // === SMART KAIJU AI: Prioritize military targets ===
    const tanks = frameSnapshot?.liveTanks || entitiesRef.current.filter(e => e.type === 'tank' && !e.dead); // Include broken tanks!
    const jets = frameSnapshot?.liveJets || entitiesRef.current.filter(e => e.type === 'jet' && !e.dead);
    const facilities = frameSnapshot?.liveFacilities || entitiesRef.current.filter(e => e.type === 'facility' && !e.dead);
    const aaSites = facilities.filter(e => e.kind === 'aa_site');
    const bunkers = frameSnapshot?.aliveBunkers || entitiesRef.current.filter(e => e.type === 'bunker' && !e.dead);
    const barricades = frameSnapshot?.liveBarricades || entitiesRef.current.filter(e => e.type === 'barricade' && !e.dead);
    
    // Find nearest military target (tanks ALWAYS first priority — destroy them!)
    let primaryTarget = null;
    let primaryDist = Infinity;
    let targetType = null;
    
    // Priority 1: ALL tanks (active AND broken — finish them off)
    tanks.forEach(t => {
       const d = Math.sqrt(Math.pow(t.x - p.x, 2) + Math.pow(t.z - p.z, 2));
       if (d < primaryDist) { primaryDist = d; primaryTarget = t; targetType = 'tank'; }
    });
    
    // Priority 2: Jets (if no tanks nearby)
    if (!primaryTarget || primaryDist > 400) {
       jets.forEach(j => {
          const d = Math.sqrt(Math.pow(j.x - p.x, 2) + Math.pow(j.z - p.z, 2));
          if (d < primaryDist) { primaryDist = d; primaryTarget = j; targetType = 'jet'; }
       });
    }
    if (p.variant === 'spicie_bird' && (!primaryTarget || primaryDist > 300)) {
      aaSites.forEach(site => {
        const d = Math.sqrt(Math.pow(site.x - p.x, 2) + Math.pow(site.z - p.z, 2));
        if (d < primaryDist) { primaryDist = d; primaryTarget = site; targetType = 'aa_site'; }
      });
    }
    
    // Priority 3: Bunker (only if no military nearby)
    let bunker = null;
    let bunkerDist = Infinity;
    bunkers.forEach(b => {
       const d = Math.sqrt(Math.pow(b.x - p.x, 2) + Math.pow(b.z - p.z, 2));
       if (d < bunkerDist) { bunkerDist = d; bunker = b; }
    });
    let barricade = null;
    let barricadeDist = Infinity;
    barricades.forEach(b => {
      const d = Math.sqrt(Math.pow(b.x - p.x, 2) + Math.pow(b.z - p.z, 2));
      if (d < barricadeDist) { barricadeDist = d; barricade = b; }
    });
    let facility = null;
    let facilityDist = Infinity;
    facilities.forEach(f => {
      const d = Math.sqrt(Math.pow(f.x - p.x, 2) + Math.pow(f.z - p.z, 2));
      if (d < facilityDist) { facilityDist = d; facility = f; }
    });
    const structureTarget = barricade && barricadeDist < 260
      ? barricade
      : facility && facilityDist < bunkerDist + 60
      ? facility
      : bunker;
    const structureDist = structureTarget === barricade
      ? barricadeDist
      : structureTarget === facility
      ? facilityDist
      : bunkerDist;
    
    // PHYSICALLY ACCURATE MOVEMENT: larger kaiju = extremely slow and heavy
    const sizeSpeedFactor = getKaijuSizeSpeedFactor(p);
    const kaijuMoveStep = frameStep * KAIJU_GLOBAL_MOVE_MULTIPLIER * sizeSpeedFactor * (variantTuning.moveMult || 1);
    const kaijuAttackStep = frameStep * KAIJU_ATTACK_RATE_MULTIPLIER * (variantTuning.attackMult || 1);

    // If military targets exist, engage them first
    if (primaryTarget && primaryDist < 600) {
       const dx = primaryTarget.x - p.x;
       const dz = primaryTarget.z - p.z;
       
       // Move toward military target but keep distance for ranged attacks
      const idealRange = isFlyingVariant ? 260 : 200; // Stay at this range for ranged attacks
       
        if (primaryDist > idealRange + 50) {
           // Move closer - extremely slow
           const baseSpeed = p.variant === 'spider' ? 0.7 : p.variant === 'octopus' ? 0.3 : p.variant === 'spicie_bird' ? 0.95 : 0.5;
           const speed = baseSpeed * kaijuMoveStep;
           p.x += (dx / primaryDist) * speed;
           p.z += (dz / primaryDist) * speed;
           p.rotation = Math.atan2(dx, dz);
           group.current.rotation.y = p.rotation;
           p.state = 'hunting';
        } else if (primaryDist < idealRange - 50) {
           // Back away to maintain range
           const speed = 0.1 * kaijuMoveStep;
           p.x -= (dx / primaryDist) * speed;
           p.z -= (dz / primaryDist) * speed;
           p.rotation = Math.atan2(dx, dz);
          group.current.rotation.y = p.rotation;
          p.state = 'attacking';
       } else {
          // ... in engagement range logic ... 
          p.state = 'attacking';
          p.rotation = Math.atan2(dx, dz);
          group.current.rotation.y = p.rotation;
           
           // RANGED ATTACK SYSTEM
           const attackChance = (p.variant === 'spicie_bird' ? 0.038 : 0.03) * kaijuAttackStep; 
           if (Math.random() < attackChance) {
             const attackId = `attack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
             
             if (p.variant === 'octopus') {
                // Toxic Ink Splash (Area Attack)
                entitiesRef.current.push({
                   id: attackId, type: 'kaiju_attack', variant: 'octopus', attackType: 'ink',
                   x: primaryTarget.x, y: getTerrainHeight(primaryTarget.x, primaryTarget.z), z: primaryTarget.z,
                   sourceX: p.x, sourceY: p.y + 20, sourceZ: p.z,
                   age: 0, dead: false
                });
             } else if (p.variant === 'spider') {
                // Web Shot
                entitiesRef.current.push({
                   id: attackId, type: 'kaiju_attack', variant: 'spider', attackType: 'web',
                   x: primaryTarget.x, y: getTerrainHeight(primaryTarget.x, primaryTarget.z), z: primaryTarget.z,
                   sourceX: p.x, sourceY: p.y + 15, sourceZ: p.z,
                   age: 0, dead: false
                });
             } else if (p.variant === 'spicie_bird') {
                entitiesRef.current.push({
                   id: attackId, type: 'kaiju_attack', variant: 'spicie_bird', attackType: 'lightning',
                   x: primaryTarget.x, y: Math.max(getTerrainHeight(primaryTarget.x, primaryTarget.z), primaryTarget.y || 0), z: primaryTarget.z,
                   sourceX: p.x, sourceY: p.y + 10, sourceZ: p.z,
                   age: 0, dead: false
                });
             } else {
                // Godzilla Fire Breath
                entitiesRef.current.push({
                   id: attackId, type: 'firebreath', 
                   x: p.x, y: p.y + 40, z: p.z,
                   targetX: primaryTarget.x, targetY: primaryTarget.y + 10, targetZ: primaryTarget.z,
                   age: 0, dead: false
                });
                AudioManager.play('fire_breath');
             }
             
             // Damage target - Actually destroy military
             if (primaryTarget.type === 'tank') {
                damageTank(primaryTarget, p.variant === 'spicie_bird' ? 120 : 150, {
                  breakOnHit: (primaryTarget.hp ?? primaryTarget.maxHp ?? TANK_BASE_HP) < 120
                });
                AudioManager.play('bomb');
             } else if (primaryTarget.type === 'jet') {
                primaryTarget.dead = true;
                AudioManager.play('bomb', { volume: 0.08, duration: 0.18 });
             } else if (primaryTarget.type === 'facility') {
                primaryTarget.hp -= p.variant === 'spicie_bird' ? BUNKER_KAIJU_DAMAGE * 1.35 : BUNKER_KAIJU_DAMAGE;
                if (primaryTarget.hp <= 0) markStructureBroken(primaryTarget);
                AudioManager.play('kaiju_roar', { volume: 0.08, duration: 0.2 });
             }
          }
       }
    } else if (structureTarget) {
       // No military nearby - approach bunker
       const dx = structureTarget.x - p.x;
       const dz = structureTarget.z - p.z;
      const standOffRange = structureTarget.type === 'barricade'
        ? 52
        : isFlyingVariant
        ? 95
        : 40; // Attack range (get right up to it!)
       
        if (structureDist > standOffRange) {
           // Move toward bunker
           const baseSpeed = p.variant === 'spider' ? 0.6 : p.variant === 'octopus' ? 0.3 : p.variant === 'spicie_bird' ? 0.78 : 0.45;
           const speed = baseSpeed * kaijuMoveStep;
           p.x += (dx / structureDist) * speed;
           p.z += (dz / structureDist) * speed;
           p.rotation = Math.atan2(dx, dz);
          group.current.rotation.y = p.rotation;
          p.state = 'approaching';
       } else {
          // Smash the bunker directly
          p.state = 'attacking_bunker';
           p.rotation = Math.atan2(dx, dz);
           group.current.rotation.y = p.rotation;
           
           const attackSpeed = (structureTarget.type === 'barricade' ? 0.05 : 0.028) * kaijuAttackStep;
           if (Math.random() < attackSpeed) {
             const incomingDamage = structureTarget.type === 'barricade'
               ? ((structureTarget.deployShieldUntil && structureTarget.deployShieldUntil > Date.now())
                 ? BARRICADE_KAIJU_DAMAGE * 0.45
                 : BARRICADE_KAIJU_DAMAGE)
               : BUNKER_KAIJU_DAMAGE;
             structureTarget.hp -= incomingDamage;
             structureTarget.lastDamagedAt = Date.now();
             AudioManager.play('kaiju_roar');
             
             // Big AoE smash effect
             const attackId = `attack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
             entitiesRef.current.push({
                 id: attackId, type: 'kaiju_attack',
                 variant: p.variant,
                 attackType: 'smash',
                 x: structureTarget.x, y: 0, z: structureTarget.z,
                 sourceX: p.x, sourceY: p.y + 30, sourceZ: p.z,
                 age: 0, dead: false
             });
             
             entitiesRef.current.push({
                 id: `scorch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type: 'scorch',
                 x: structureTarget.x, z: structureTarget.z, radius: structureTarget.type === 'barricade' ? 62 : 100, dead: false
             });
             
             if (structureTarget.hp <= 0) {
               if (structureTarget.type === 'facility' || structureTarget.type === 'bunker') {
                 markStructureBroken(structureTarget);
               } else {
                 structureTarget.dead = true;
               }
             }
          }
       }
    } else {
       // No targets - wander
       const wanderSpeed = 0.5 * kaijuMoveStep * KAIJU_WANDER_MOVE_MULTIPLIER;
       p.x += Math.sin(Date.now() * 0.0005) * wanderSpeed;
       p.z += Math.cos(Date.now() * 0.0005) * wanderSpeed;
       group.current.rotation.y = Date.now() * 0.0005;
       p.rotation = group.current.rotation.y;
       p.state = 'wandering';
    }

    if (!p.nextRageBurstAt) {
      p.nextRageBurstAt = now + 2.5 + Math.random() * 2;
    }
    if (p.state !== 'dying' && now >= p.nextRageBurstAt) {
      spawnKaijuChaosBurst(entitiesRef.current, p);
      p.nextRageBurstAt = now + 4.5 + Math.random() * 3.5 + (p.variant === 'octopus' ? 0.8 : 0);
    }
    
    // Ensure the Kaiju walks accurately on the 3D Mountain Terrain instead of floating or sinking (fixes glitching overlap)
    const prevX = p.prevAudioX ?? p.x;
    const prevZ = p.prevAudioZ ?? p.z;
    const movedDistance = Math.sqrt(Math.pow(p.x - prevX, 2) + Math.pow(p.z - prevZ, 2));
    if (!p.nextFootfallAt) {
      p.nextFootfallAt = now + 0.15;
    }
    if (!p.nextTrailScorchAt) {
      p.nextTrailScorchAt = now + 14 + Math.random() * 6;
    }
    if (movedDistance > 0.12 && p.state !== 'dying' && now >= p.nextFootfallAt) {
      p.footfallSide = p.footfallSide === 1 ? -1 : 1;
      const shouldLeaveScorch = now >= p.nextTrailScorchAt;
      spawnKaijuFootfallEffect(entitiesRef.current, p, p.footfallSide || 1, shouldLeaveScorch);
      p.nextFootfallAt = now + Math.max(
        0.18,
        0.58 - sizeSpeedFactor * 0.12 - (p.variant === 'spider' ? 0.12 : 0)
      );
      if (shouldLeaveScorch) {
        p.nextTrailScorchAt = now + 12 + Math.random() * 6;
      }
    }
    p.stepAudioTravel = (p.stepAudioTravel || 0) + movedDistance;
    p.prevAudioX = p.x;
    p.prevAudioZ = p.z;
    if (p.stepAudioTravel > Math.max(18, (p.scale || 5) * 3) && p.state !== 'attacking' && p.state !== 'dying') {
      AudioManager.play('kaiju_step');
      p.stepAudioTravel = 0;
    }

    if (isFlyingVariant) {
      const terrainY = getTerrainHeight(p.x, p.z);
      if (p.flightBaseHeight === undefined || !Number.isFinite(p.flightBaseHeight)) {
        p.flightBaseHeight = terrainY + (KAIJU_VARIANT_CONFIG[p.variant]?.cruiseHeight || 120);
      }
      p.flightPhase = (p.flightPhase || 0) + delta * (p.isMini ? 1.55 : 1.1);
      const liftWave = Math.sin(now * 2.4 + p.flightPhase) * 18 + Math.sin(now * 0.95 + p.flightPhase * 0.7) * 12;
      const desiredY = Math.max(terrainY + 70, p.flightBaseHeight + liftWave);
      p.y = THREE.MathUtils.lerp(p.y || desiredY, desiredY, Math.min(1, delta * 2.4));
    } else {
      p.y = getTerrainHeight(p.x, p.z);
    }
    group.current.position.set(p.x, p.y, p.z);
    
    // Natural breathing animation
    const breathe = Math.sin(Date.now() * 0.002) * 0.03;
    group.current.scale.set(
      baseScale,
      baseScale * (1 + (p.variant === 'spider' ? breathe * 0.4 : isFlyingVariant ? breathe * 0.25 : breathe)),
      baseScale
    );
    
    // Idle sway when not moving much
    const idleSway = Math.sin(Date.now() * 0.001) * 0.02;
    group.current.rotation.z = p.variant === 'spider' ? idleSway * 0.45 : isFlyingVariant ? idleSway * 0.2 : idleSway;
    group.current.rotation.x = p.variant === 'spider'
      ? 0.025 + Math.sin(Date.now() * 0.0015) * 0.008
      : isFlyingVariant
      ? -0.08 + Math.sin(Date.now() * 0.0022) * 0.02
      : Math.sin(Date.now() * 0.0015) * 0.015;
    if (damageStageLive > 0) {
      const woundShake = Math.sin(state.clock.elapsedTime * (damageStageLive >= 2 ? 7.2 : 4.8)) * 0.01 * damageStageLive;
      group.current.rotation.z += woundShake * (p.variant === 'spider' ? 0.8 : 1);
      group.current.rotation.x += damageStageLive >= 2 ? 0.01 + woundShake * 0.4 : 0;
    }
    
    // More dynamic movement when walking
    if (p.state !== 'attacking_bunker' && p.state !== 'dying') {
        const walkBob = Math.sin(Date.now() * 0.008) * (p.variant === 'spider' ? 0.022 : isFlyingVariant ? 0.03 : 0.05);
        group.current.position.y = p.y + Math.abs(walkBob) * (p.variant === 'spider' ? baseScale / 9 : isFlyingVariant ? baseScale / 11 : baseScale / 5);
        group.current.rotation.z = Math.sin(Date.now() * 0.006) * (p.variant === 'spider' ? 0.035 : isFlyingVariant ? 0.028 : 0.08);
    }
    
    // Attack anticipation - lean back before striking
    if (p.state === 'attacking_bunker') {
        const attackWindup = Math.sin(Date.now() * 0.01) * 0.15;
        if (group.current) {
            group.current.position.set(p.x, p.y, p.z);
            group.current.rotation.y = p.rotation ?? group.current.rotation.y;
            group.current.rotation.x = p.variant === 'spider'
              ? 0.14 + attackWindup * 0.2
              : p.variant === 'spicie_bird'
              ? -0.24 + attackWindup * 0.14
              : -0.1 + attackWindup;
        }
    }
    
    if (jawRef.current) {
       jawRef.current.rotation.x = 0.4 + Math.sin(Date.now() * 0.005) * 0.3;
    }

    if (p.variant === 'spider') {
      const crawlSpeed = THREE.MathUtils.clamp(movedDistance * 16 + (p.state === 'hunting' || p.state === 'approaching' ? 1.1 : 0.45), 0.45, 2.5);
      const crawlTime = state.clock.elapsedTime * crawlSpeed * 2.8;
      const attackSpread = p.state === 'attacking' || p.state === 'attacking_bunker' ? 0.22 : 0;
      const crouchAmount = p.state === 'attacking_bunker' ? 1 : p.state === 'attacking' ? 0.72 : p.state === 'hunting' || p.state === 'approaching' ? 0.5 : 0.28;

      if (spiderRootRef.current) {
        spiderRootRef.current.position.y = 4.8 - crouchAmount * 1.6 + Math.abs(Math.sin(crawlTime * 0.55)) * 0.35;
        spiderRootRef.current.rotation.x = 0.06 + crouchAmount * 0.08 + Math.sin(crawlTime * 0.32) * 0.02;
      }
      if (spiderAbdomenRef.current) {
        spiderAbdomenRef.current.position.y = 15.3 + Math.sin(crawlTime * 0.42 + 0.8) * 0.65;
        spiderAbdomenRef.current.rotation.x = -0.16 + Math.sin(crawlTime * 0.34 + 0.5) * 0.05;
        spiderAbdomenRef.current.rotation.z = Math.sin(crawlTime * 0.45) * 0.025;
      }
      if (spiderThoraxRef.current) {
        spiderThoraxRef.current.rotation.x = 0.08 + Math.sin(crawlTime * 0.5) * 0.02;
      }
      if (spiderHeadRef.current) {
        spiderHeadRef.current.rotation.x = -0.08 + crouchAmount * 0.12 + Math.sin(crawlTime * 0.62) * 0.025;
      }
      spiderPedipalpRefs.current.forEach((pedipalp, index) => {
        if (!pedipalp) return;
        const side = index === 0 ? -1 : 1;
        pedipalp.rotation.x = 0.38 + crouchAmount * 0.16 + Math.sin(crawlTime * 0.85 + index * 0.9) * 0.08;
        pedipalp.rotation.z = side * (-0.28 - attackSpread * 0.35);
      });
      spiderLegRefs.current.forEach((leg, index) => {
        if (!leg) return;
        const config = spiderLegConfigs[index];
        if (!config) return;
        const step = Math.sin(crawlTime + config.phase);
        const plant = Math.cos(crawlTime + config.phase * 0.6);
        const limp = damageStageLive >= 2 && (index === 1 || index === 6) ? damageStageLive * 0.1 : 0;
        if (leg.upper) {
          leg.upper.rotation.y = config.yaw + config.stride * step;
          leg.upper.rotation.z = config.side * (config.splay + config.lift * Math.max(0, step) + attackSpread - limp);
        }
        if (leg.mid) {
          leg.mid.rotation.z = config.side * (-0.9 - config.lift * 0.8 * Math.max(0, -step) + limp * 0.7);
          leg.mid.rotation.x = -0.1 + Math.abs(step) * 0.08;
        }
        if (leg.lower) {
          leg.lower.rotation.z = config.side * (0.84 + config.lift * 0.55 * Math.max(0, step) + limp);
          leg.lower.rotation.x = 0.12 + Math.max(0, plant) * 0.06;
        }
      });
    }
    if (p.variant === 'spicie_bird') {
      const flapSpeed = THREE.MathUtils.clamp(
        movedDistance * 12 + (p.state === 'hunting' || p.state === 'approaching' ? 2.4 : 1.5),
        1.2,
        4.2
      );
      const flap = Math.sin(state.clock.elapsedTime * flapSpeed * 4.6);
      const glide = Math.sin(state.clock.elapsedTime * 1.4 + (p.flightPhase || 0)) * 0.04;
      if (birdRootRef.current) {
        birdRootRef.current.position.y = 12 + Math.abs(flap) * 1.2;
        birdRootRef.current.rotation.x = -0.08 + glide;
      }
      if (birdLeftWingRef.current) {
        birdLeftWingRef.current.rotation.z = -0.38 + flap * 0.78;
        birdLeftWingRef.current.rotation.y = -0.08 + flap * 0.06;
      }
      if (birdRightWingRef.current) {
        birdRightWingRef.current.rotation.z = 0.38 - flap * 0.78;
        birdRightWingRef.current.rotation.y = 0.08 - flap * 0.06;
      }
      if (birdTailRef.current) {
        birdTailRef.current.rotation.x = 0.3 + Math.sin(state.clock.elapsedTime * 2.1) * 0.08;
      }
      if (birdHeadRef.current) {
        birdHeadRef.current.rotation.x = 0.12 + Math.sin(state.clock.elapsedTime * 2.7) * 0.07;
      }
    }

    if (hpBar.current) hpBar.current.lookAt(camera.position);
  });

  const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  if (!p || p.dead) return null;
  const hpPercent = Math.max(0, p.hp / p.maxHp);
  const damageStage = hpPercent <= 0.2 ? 3 : hpPercent <= 0.45 ? 2 : hpPercent <= 0.7 ? 1 : 0;
  const isWounded = damageStage >= 1;
  const isHeavyWounded = damageStage >= 2;
  const isCritical = damageStage >= 3;
  const woundPulse = 0.55 + Math.sin(Date.now() * 0.008) * 0.2;
  const renderKaijuDamageOverlays = () => {
    if (!isWounded) return null;
    if (p.variant === 'octopus') {
      return (
        <>
          {[[-6, 17, 4], [4, 20, -2], [0, 14, 7]].map((scar, i) => (
            <mesh key={`octo-rupture-${i}`} position={scar} rotation={[0.4, i * 0.6, 0.2]}>
              <capsuleGeometry args={[0.9, 6, 4, 8]} />
              <meshStandardMaterial color="#7f1d1d" emissive="#991b1b" emissiveIntensity={(isCritical ? 1.1 : 0.55) * woundPulse} roughness={0.95} />
            </mesh>
          ))}
        </>
      );
    }
    if (p.variant === 'spider') {
      return (
        <>
          {[[-3.2, 18.4, -22], [3.1, 17.8, -19], [-1.8, 19.6, -14], [2.2, 18.9, -12]].map((scar, index) => (
            <mesh key={`abdomen-scar-${index}`} position={scar} rotation={[0.5, index * 0.3, 0.2]}>
              <capsuleGeometry args={[0.7, 3.2, 4, 8]} />
              <meshStandardMaterial color="#7f1d1d" emissive="#7f1d1d" emissiveIntensity={(isCritical ? 0.9 : 0.42) * woundPulse} roughness={0.92} />
            </mesh>
          ))}
        </>
      );
    }
    if (p.variant === 'spicie_bird') {
      return (
        <>
          {[[-4.6, 15.6, 5], [3.8, 17.4, -1], [1.6, 13.6, -8]].map((scar, index) => (
            <mesh key={`bird-scar-${index}`} position={scar} rotation={[0.3, index * 0.4, 0.2]}>
              <capsuleGeometry args={[0.78, 5.4, 4, 8]} />
              <meshStandardMaterial color="#7f1d1d" emissive="#991b1b" emissiveIntensity={(isCritical ? 1.05 : 0.52) * woundPulse} />
            </mesh>
          ))}
        </>
      );
    }
    if (p.variant === 'beetle') {
      return (
        <>
          {[[-5, 25, 6], [4, 22, 10], [0, 19, -4]].map((scar, index) => (
            <mesh key={`beetle-scar-${index}`} position={scar} rotation={[0.22, index * 0.35, 0.4]}>
              <capsuleGeometry args={[0.9, 7.4, 4, 8]} />
              <meshStandardMaterial color="#7f1d1d" emissive="#b45309" emissiveIntensity={(isCritical ? 1.1 : 0.5) * woundPulse} roughness={0.9} />
            </mesh>
          ))}
        </>
      );
    }
    if (p.variant === 'wyrm') {
      return (
        <>
          {[[-4, 20, 4], [4, 18, -8], [0, 14, -16]].map((scar, index) => (
            <mesh key={`wyrm-scar-${index}`} position={scar} rotation={[0.3, index * 0.3, 0.25]}>
              <capsuleGeometry args={[0.85, 8, 4, 8]} />
              <meshStandardMaterial color="#7f1d1d" emissive="#84cc16" emissiveIntensity={(isCritical ? 1.2 : 0.46) * woundPulse} roughness={0.92} />
            </mesh>
          ))}
        </>
      );
    }
    return (
      <>
        {[[-6, 29, 12], [4, 23, 14], [1, 34, 9]].map((scar, index) => (
          <mesh key={`zilla-chest-scar-${index}`} position={scar} rotation={[0.3, index * 0.4, 0.45]}>
            <capsuleGeometry args={[0.95, 8.5, 4, 8]} />
            <meshStandardMaterial color="#7f1d1d" emissive={isHeavyWounded ? "#f97316" : "#991b1b"} emissiveIntensity={(isCritical ? 1.4 : 0.6) * woundPulse} roughness={0.92} />
          </mesh>
        ))}
      </>
    );
  };

  const renderVariant = () => {
     const moveTime = Date.now() * 0.003;
     if (kaijuScene) {
        return (
          <group>
            <primitive object={kaijuScene} />
            {renderKaijuDamageOverlays()}
          </group>
        );
     }
     if (p.variant === 'octopus') {
        return (
           <group position={[0, 4, 0]}>
               {/* Pulsing Core / Brain Hub (High-Res) */}
               <mesh position={[0, 16, 0]}>
                   <sphereGeometry args={[10, 24, 24]} />
                   <meshStandardMaterial color={isHeavyWounded ? "#3b0a0a" : "#2e1065"} roughness={0.4} metalness={0.6} emissive={isHeavyWounded ? "#7f1d1d" : "#4c1d95"} emissiveIntensity={isCritical ? 1.3 : 0.5} />
               </mesh>
               {/* Translucent Outer Membrane */}
               <mesh position={[0, 18, 0]} scale={[1.2, 1.4, 1.2]}>
                   <sphereGeometry args={[9, 20, 20]} />
                   <meshStandardMaterial color={isHeavyWounded ? "#5b1720" : "#6b21a8"} transparent opacity={isCritical ? 0.26 : 0.4} roughness={0.1} />
                </mesh>
               {isWounded && [[-6, 17, 4], [4, 20, -2], [0, 14, 7]].map((scar, i) => (
                 <mesh key={`octo-rupture-${i}`} position={scar} rotation={[0.4, i * 0.6, 0.2]}>
                    <capsuleGeometry args={[0.9, 6, 4, 8]} />
                    <meshStandardMaterial color="#7f1d1d" emissive="#991b1b" emissiveIntensity={(isCritical ? 1.1 : 0.55) * woundPulse} roughness={0.95} />
                 </mesh>
               ))}
               {isHeavyWounded && [[-3, 9, 5], [3, 11, 4], [0, 8, -3]].map((blister, i) => (
                 <mesh key={`octo-blister-${i}`} position={blister} scale={[1.2, 0.6, 1]}>
                    <sphereGeometry args={[2.4, 10, 10]} />
                    <meshStandardMaterial color="#1f2937" emissive="#14532d" emissiveIntensity={isCritical ? 1.2 : 0.45} transparent opacity={0.82} />
                 </mesh>
               ))}
               {/* Toxic Beady Eyes - cluster of 4 */}
               {[[-4, 12, 8], [4, 12, 8], [-2, 11, 10], [2, 11, 10]].map((pos, i) => (
                  <mesh key={i} position={pos}>
                     <sphereGeometry args={[1.5, 12, 12]} />
                     <meshStandardMaterial color="#00ff00" emissive="#10b981" emissiveIntensity={isCritical ? 12 : isWounded ? 6 : 8} />
                  </mesh>
               ))}
               {/* Beak / Maw at bottom */}
               <mesh position={[0, 8, 4]} rotation={[Math.PI/4, 0, 0]}>
                  <coneGeometry args={[4, 8, 16]} />
                  <meshStandardMaterial color="#000000" />
               </mesh>
               {/* High-Resolution Segmented Tentacles */}
               {[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
                  const angle = (i / 8) * Math.PI * 2;
                  const sway = Math.sin(moveTime + i) * 0.2;
                  return (
                    <group key={i} rotation={[0, angle + sway, 0]} position={[0, 10, 0]}>
                       {/* Tentacle Segment 1 */}
                       <mesh position={[0, 0, 8]} rotation={[0.8, 0, 0]}>
                          <cylinderGeometry args={[2.5, 2, 12, 12]} />
                          <meshStandardMaterial color="#4c1d95" roughness={0.3} />
                       </mesh>
                       {/* Tentacle Segment 2 (Bendy tip) */}
                       <group position={[0, -4, 16]} rotation={[0.6 + Math.sin(moveTime + i)*0.2, 0, 0]}>
                       <mesh position={[0, -4, 4]}>
                             <cylinderGeometry args={[2, 0.2, 15, 12]} />
                             <meshStandardMaterial color={isHeavyWounded ? "#4c1d95" : "#5b21b6"} roughness={0.5} />
                          </mesh>
                          {/* Glowing Suckers */}
                          {[4, 8, 12].map(j => (
                             <mesh key={j} position={[0, -j, 1]} rotation={[Math.PI/2, 0, 0]}>
                                <circleGeometry args={[0.8, 8]} />
                                <meshStandardMaterial color={isHeavyWounded ? "#f97316" : "#34d399"} emissive={isHeavyWounded ? "#fb923c" : "#34d399"} emissiveIntensity={isCritical ? 6 : 4} side={2} />
                             </mesh>
                          ))}
                       </group>
                    </group>
                  )
               })}
           </group>
        );
     } else if (p.variant === 'spider') {
        return (
           <group ref={spiderRootRef} position={[0, 4.8, 0]}>
               <group ref={spiderAbdomenRef} position={[0, 15.2, -20]}>
                  <mesh rotation={[-0.14, 0, 0]} scale={[1.15, 0.88, 1.72]}>
                     <sphereGeometry args={[10.8, 22, 22]} />
                     <meshStandardMaterial color="#06080d" roughness={0.82} metalness={0.08} />
                  </mesh>
                  <mesh position={[0, 0.5, -1.5]} rotation={[-0.1, 0, 0]} scale={[0.9, 0.45, 1.2]}>
                     <sphereGeometry args={[8.2, 18, 18]} />
                     <meshStandardMaterial color="#2b0d0d" emissive="#6b1111" emissiveIntensity={isCritical ? 1.3 * woundPulse : isHeavyWounded ? 0.9 : 0.65} transparent opacity={0.62} />
                  </mesh>
                  {isWounded && [[-3.2, 2.8, -3], [3.1, 2.2, -1.5], [-1.8, 4.2, 3.5], [2.2, 3.5, 5]].map((scar, index) => (
                    <mesh key={`abdomen-scar-${index}`} position={scar} rotation={[0.5, index * 0.3, 0.2]}>
                      <capsuleGeometry args={[0.7, 3.2, 4, 8]} />
                      <meshStandardMaterial color="#7f1d1d" emissive="#7f1d1d" emissiveIntensity={(isCritical ? 0.9 : 0.42) * woundPulse} roughness={0.92} />
                    </mesh>
                  ))}
                  {[[-2.4, 7.8, -1], [0, 8.5, 2.8], [2.6, 7.4, 5.4]].map((spine, index) => (
                    <mesh key={`abdomen-spine-${index}`} position={spine} rotation={[-0.7, index * 0.18, 0]}>
                      <coneGeometry args={[1.2 - index * 0.1, 5.5 - index * 0.5, 5]} />
                      <meshStandardMaterial color="#111827" emissive="#365314" emissiveIntensity={isCritical && index === 1 ? 0.5 : 0.18} />
                    </mesh>
                  ))}
                  {isHeavyWounded && [[-5.4, 0.8, 2.4], [4.9, 1.5, 4.2]].map((tear, index) => (
                    <mesh key={`abdomen-tear-${index}`} position={tear} rotation={[0.3, index * 0.4, 0.5]}>
                      <capsuleGeometry args={[0.95, 5.4, 4, 8]} />
                      <meshStandardMaterial color="#111827" emissive="#991b1b" emissiveIntensity={isCritical ? 1.1 : 0.6} roughness={0.98} />
                    </mesh>
                  ))}
               </group>

               <group ref={spiderThoraxRef} position={[0, 10.6, -1.8]}>
                  <mesh rotation={[0.08, 0, 0]} scale={[1.12, 0.68, 1.18]}>
                     <sphereGeometry args={[9.4, 22, 22]} />
                     <meshStandardMaterial color="#090d15" roughness={0.58} metalness={0.22} />
                  </mesh>
                  <mesh position={[0, 1.4, -1.5]} rotation={[0.15, 0, 0]} scale={[0.8, 0.22, 0.8]}>
                     <sphereGeometry args={[7.8, 18, 18]} />
                     <meshStandardMaterial color="#1f2937" emissive="#3f6212" emissiveIntensity={0.22} transparent opacity={0.32} />
                  </mesh>
                  {[[-5.4, -0.6, -4.2], [5.4, -0.6, -4.2], [-5.8, -0.2, 2.4], [5.8, -0.2, 2.4]].map((socket, index) => (
                    <mesh key={`leg-socket-${index}`} position={socket} scale={[1.2, 0.6, 0.9]}>
                      <sphereGeometry args={[1.8, 10, 10]} />
                      <meshStandardMaterial color="#111827" roughness={0.9} />
                    </mesh>
                  ))}
               </group>

               <group ref={spiderHeadRef} position={[0, 9.2, 12.5]}>
                  <mesh rotation={[-0.08, 0, 0]} scale={[1.04, 0.72, 1.12]}>
                     <sphereGeometry args={[6.6, 18, 18]} />
                     <meshStandardMaterial color="#05070c" roughness={0.62} metalness={0.12} />
                  </mesh>
                  <mesh position={[0, 0.2, 4.3]} scale={[0.74, 0.2, 0.4]}>
                     <sphereGeometry args={[4.8, 12, 12]} />
                     <meshStandardMaterial color="#2b0d0d" emissive="#7f1d1d" emissiveIntensity={isCritical ? 1.5 * woundPulse : 0.78} transparent opacity={0.68} />
                  </mesh>
                  {[[-2.7, 1.7, 4.6], [2.7, 1.7, 4.6], [-4.1, 0.2, 3.9], [4.1, 0.2, 3.9], [-1.4, -1.1, 4.8], [1.4, -1.1, 4.8]].map((eye, index) => (
                    <mesh key={`spider-eye-${index}`} position={eye}>
                      <sphereGeometry args={[0.72, 8, 8]} />
                      <meshStandardMaterial color="#f8fafc" emissive={isCritical ? "#dc2626" : "#f87171"} emissiveIntensity={isCritical ? 4.5 : isWounded ? 2 : 2.5} />
                    </mesh>
                  ))}
                  {isHeavyWounded && [[0, -0.8, 4.4], [-1.2, -1.6, 4.2], [1.2, -1.6, 4.2]].map((mandibleScar, index) => (
                    <mesh key={`face-wound-${index}`} position={mandibleScar} rotation={[0.8, index * 0.3, 0]}>
                      <capsuleGeometry args={[0.35, 2.2, 4, 8]} />
                      <meshStandardMaterial color="#7f1d1d" emissive="#991b1b" emissiveIntensity={0.6} />
                    </mesh>
                  ))}
                  {[-1, 1].map((side, index) => (
                    <group key={`pedipalp-${side}`} ref={registerSpiderPedipalp(index)} position={[side * 2.4, -1.4, 3.6]}>
                      <mesh position={[side * 1.8, -1.6, 1.2]} rotation={[0.42, 0, side * 0.28]}>
                        <capsuleGeometry args={[0.55, 4.2, 4, 8]} />
                        <meshStandardMaterial color="#0f172a" roughness={0.78} />
                      </mesh>
                    </group>
                  ))}
                  {[-1, 1].map((side) => (
                    <group key={`fang-${side}`} position={[side * 1.7, -2.4, 4.3]} rotation={[0.75, side * 0.12, side * -0.24]}>
                      <mesh position={[0, -2.5, 1.3]} rotation={[0.16, 0, side * 0.08]}>
                        <cylinderGeometry args={[0.26, 0.06, 5.8, 8]} />
                        <meshStandardMaterial color="#e5e7eb" roughness={0.24} metalness={0.12} />
                      </mesh>
                    </group>
                  ))}
               </group>

               {spiderLegConfigs.map((leg, index) => {
                 const side = leg.side;
                 return (
                   <group key={`spider-leg-${index}`} position={leg.anchor}>
                      <group ref={registerSpiderLegPart(index, 'upper')} rotation={[0.08, leg.yaw, side * leg.splay]}>
                         <mesh position={[side * 6.8, -0.6, side * 0.35]} rotation={[0.08, 0, side * -0.48]}>
                            <cylinderGeometry args={[1.08, 0.92, 14, 8]} />
                            <meshStandardMaterial color="#090d15" roughness={0.84} />
                         </mesh>
                         <mesh position={[side * 12.2, -1.2, side * 1.4]} rotation={[0.16, 0, side * -0.22]}>
                            <sphereGeometry args={[1.35, 8, 8]} />
                            <meshStandardMaterial color="#111827" />
                         </mesh>
                         <group ref={registerSpiderLegPart(index, 'mid')} position={[side * 12.2, -1.2, side * 1.4]} rotation={[0.12, 0, side * -0.92]}>
                            <mesh position={[side * 6.9, -3.8, 0]} rotation={[0.08, 0, side * 0.26]}>
                               <cylinderGeometry args={[0.82, 0.62, 15.5, 8]} />
                               <meshStandardMaterial color="#0b1220" roughness={0.88} />
                            </mesh>
                            <mesh position={[side * 13, -7.2, 0]} scale={[1.05, 0.82, 0.95]}>
                               <sphereGeometry args={[1.1, 8, 8]} />
                               <meshStandardMaterial color="#111827" />
                            </mesh>
                            <group ref={registerSpiderLegPart(index, 'lower')} position={[side * 13, -7.2, 0]} rotation={[0.08, 0, side * 0.9]}>
                               <mesh position={[side * 6.7, -4.6, 0.4]} rotation={[0.12, 0, side * 0.2]}>
                                  <cylinderGeometry args={[0.52, 0.18, 14.8, 7]} />
                                  <meshStandardMaterial color="#1f2937" roughness={0.82} />
                               </mesh>
                               <mesh position={[side * 12.8, -9.1, 0.8]} rotation={[0.22, 0, side * 0.12]}>
                                  <coneGeometry args={[0.42, 3.8, 5]} />
                                  <meshStandardMaterial color="#f8fafc" roughness={0.16} metalness={0.08} />
                               </mesh>
                            </group>
                         </group>
                      </group>
                      {[0, 1].map((spur) => (
                        <mesh
                          key={`leg-spur-${index}-${spur}`}
                          position={[side * (6.4 + spur * 4.2), 2.4 - spur * 3.2, spur === 0 ? -1.2 : 1.4]}
                          rotation={[0.35, 0, side * (spur === 0 ? -0.8 : -0.55)]}
                        >
                          <coneGeometry args={[0.3, 2.8 - spur * 0.4, 4]} />
                          <meshStandardMaterial color="#111827" emissive="#365314" emissiveIntensity={0.08} />
                        </mesh>
                      ))}
                   </group>
                 );
               })}
           </group>
        );
     } else if (p.variant === 'spicie_bird') {
        return (
           <group ref={birdRootRef} position={[0, 10, 0]}>
              <group position={[0, 15, -2]}>
                <mesh scale={[0.84, 0.72, 1.62]}>
                  <sphereGeometry args={[13, 22, 22]} />
                  <meshStandardMaterial color="#0b1220" roughness={0.6} metalness={0.25} />
                </mesh>
                <mesh position={[0, 0.8, -3.4]} scale={[0.68, 0.34, 1.1]}>
                  <sphereGeometry args={[10, 16, 16]} />
                  <meshStandardMaterial color="#3f1d1d" emissive="#7f1d1d" emissiveIntensity={isCritical ? 1.15 * woundPulse : isWounded ? 0.7 : 0.35} transparent opacity={0.58} />
                </mesh>
                {isWounded && [[-4.6, 0.6, 7], [3.8, 2.4, 1.2], [1.6, -1.4, -6.2]].map((scar, index) => (
                  <mesh key={`bird-scar-${index}`} position={scar} rotation={[0.3, index * 0.4, 0.2]}>
                    <capsuleGeometry args={[0.78, 5.4, 4, 8]} />
                    <meshStandardMaterial color="#7f1d1d" emissive="#991b1b" emissiveIntensity={(isCritical ? 1.05 : 0.52) * woundPulse} />
                  </mesh>
                ))}
              </group>

              <group ref={birdHeadRef} position={[0, 20, 17]}>
                <mesh scale={[0.86, 0.66, 1.08]}>
                  <sphereGeometry args={[7.4, 20, 20]} />
                  <meshStandardMaterial color="#111827" roughness={0.52} metalness={0.28} />
                </mesh>
                <mesh position={[0, -0.8, 7.2]} rotation={[-0.1, 0, 0]}>
                  <coneGeometry args={[2.8, 8.8, 7]} />
                  <meshStandardMaterial color="#facc15" roughness={0.35} metalness={0.1} />
                </mesh>
                {[[-2.1, 1.5, 5.1], [2.1, 1.5, 5.1], [-0.9, 0.9, 5.8], [0.9, 0.9, 5.8]].map((eye, i) => (
                  <mesh key={`bird-eye-${i}`} position={eye}>
                    <sphereGeometry args={[0.85, 8, 8]} />
                    <meshStandardMaterial color="#f8fafc" emissive={isCritical ? "#ef4444" : "#f97316"} emissiveIntensity={isCritical ? 5.5 : 2.4} />
                  </mesh>
                ))}
                {[-1, 1].map((side) => (
                  <mesh key={`fang-${side}`} position={[side * 1.4, -1.9, 6.4]} rotation={[0.8, side * 0.15, side * -0.16]}>
                    <cylinderGeometry args={[0.25, 0.08, 4.5, 8]} />
                    <meshStandardMaterial color="#e5e7eb" roughness={0.22} />
                  </mesh>
                ))}
              </group>

              <group ref={birdLeftWingRef} position={[-14, 16, -2]}>
                <mesh rotation={[0.08, 0.04, -0.2]}>
                  <boxGeometry args={[28, 1.8, 11]} />
                  <meshStandardMaterial color="#1f2937" roughness={0.78} metalness={0.18} />
                </mesh>
                <mesh position={[-12, -0.8, 1.8]} rotation={[0.2, 0, -0.25]}>
                  <boxGeometry args={[16, 1.1, 7.5]} />
                  <meshStandardMaterial color="#111827" roughness={0.86} />
                </mesh>
                {[[-7, 1.4, -3], [-15, 1.1, -1], [-20, 1.2, 2.6]].map((spike, idx) => (
                  <mesh key={`wingl-spike-${idx}`} position={spike} rotation={[0.5, 0.1, -0.4]}>
                    <coneGeometry args={[0.85 - idx * 0.08, 4.3 - idx * 0.3, 5]} />
                    <meshStandardMaterial color="#334155" emissive="#7f1d1d" emissiveIntensity={isCritical ? 0.45 : 0.12} />
                  </mesh>
                ))}
              </group>

              <group ref={birdRightWingRef} position={[14, 16, -2]}>
                <mesh rotation={[0.08, -0.04, 0.2]}>
                  <boxGeometry args={[28, 1.8, 11]} />
                  <meshStandardMaterial color="#1f2937" roughness={0.78} metalness={0.18} />
                </mesh>
                <mesh position={[12, -0.8, 1.8]} rotation={[0.2, 0, 0.25]}>
                  <boxGeometry args={[16, 1.1, 7.5]} />
                  <meshStandardMaterial color="#111827" roughness={0.86} />
                </mesh>
                {[ [7, 1.4, -3], [15, 1.1, -1], [20, 1.2, 2.6] ].map((spike, idx) => (
                  <mesh key={`wingr-spike-${idx}`} position={spike} rotation={[0.5, -0.1, 0.4]}>
                    <coneGeometry args={[0.85 - idx * 0.08, 4.3 - idx * 0.3, 5]} />
                    <meshStandardMaterial color="#334155" emissive="#7f1d1d" emissiveIntensity={isCritical ? 0.45 : 0.12} />
                  </mesh>
                ))}
              </group>

              <group ref={birdTailRef} position={[0, 14, -25]}>
                <mesh rotation={[0.35, 0, 0]}>
                  <boxGeometry args={[7.5, 1.2, 16]} />
                  <meshStandardMaterial color="#0f172a" roughness={0.84} />
                </mesh>
                <mesh position={[0, -0.5, -7.4]} rotation={[0.5, 0, 0]}>
                  <coneGeometry args={[3.8, 8.2, 6]} />
                  <meshStandardMaterial color="#1e293b" roughness={0.78} />
                </mesh>
              </group>

              {[-1, 1].map((side, i) => (
                <group key={`talon-${side}`} position={[side * 4.6, 8.5, 8]}>
                  <mesh rotation={[0.7, 0, side * 0.12]}>
                    <cylinderGeometry args={[0.45, 0.32, 6.2, 8]} />
                    <meshStandardMaterial color="#374151" roughness={0.58} metalness={0.3} />
                  </mesh>
                  {[0, 1, 2].map((claw) => (
                    <mesh key={`claw-${i}-${claw}`} position={[side * (claw - 1) * 0.9, -3.2, 1.4 + claw * 0.8]} rotation={[1, 0, side * (0.08 + claw * 0.05)]}>
                      <coneGeometry args={[0.33, 2.8, 5]} />
                      <meshStandardMaterial color="#e2e8f0" roughness={0.22} metalness={0.12} />
                    </mesh>
                  ))}
                </group>
              ))}
           </group>
        );
     }
     
     // Default: Godzilla - Behemoth Overhaul
     return (
        <group position={[0, 0, 0]}>
          {/* Main Body - Armored segments */}
          <group position={[0, 24, -4]} rotation={[0.2, 0, 0]}>
             <mesh>
                <sphereGeometry args={[15, 24, 24]} scale={[1, 1.6, 1.2]} />
                <meshStandardMaterial color={isHeavyWounded ? "#111111" : "#0f172a"} roughness={0.4} metalness={0.7} />
             </mesh>
             {/* Glowing Radioactive Chest Veins */}
             <mesh position={[0, 0, 12]} scale={[0.8, 1, 0.2]}>
                <sphereGeometry args={[10, 16, 16]} />
                <meshStandardMaterial color={isHeavyWounded ? "#f97316" : "#22c55e"} emissive={isHeavyWounded ? "#fb923c" : "#16a34a"} emissiveIntensity={isCritical ? 9 * woundPulse : isWounded ? 4.2 : 6} transparent opacity={0.6} />
             </mesh>
             {isWounded && [[-6, 5, 9], [4, -1, 11], [1, 8, 10]].map((scar, index) => (
               <mesh key={`zilla-chest-scar-${index}`} position={scar} rotation={[0.3, index * 0.4, 0.45]}>
                  <capsuleGeometry args={[0.95, 8.5, 4, 8]} />
                  <meshStandardMaterial color="#7f1d1d" emissive={isHeavyWounded ? "#f97316" : "#991b1b"} emissiveIntensity={(isCritical ? 1.4 : 0.6) * woundPulse} roughness={0.92} />
               </mesh>
             ))}
          </group>
          
          {/* Jagged Crystalline Back Spines (High-Res) */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
             <mesh key={i} position={[0, 45 - i * 6, -10 - i * 3]} rotation={[-0.4 - i * 0.05, 0, (i%2===0?0.2:-0.2)]}>
                <coneGeometry args={[3, 12 + i, 6]} />
                <meshStandardMaterial color="#020617" emissive={isHeavyWounded ? "#ea580c" : "#15803d"} emissiveIntensity={isCritical ? (i % 3 === 0 ? 5.2 : 1.8) : i%3===0?3:0.5} />
             </mesh>
          ))}
          {isHeavyWounded && [[0, 39, -14], [0, 27, -20]].map((fracture, index) => (
            <mesh key={`zilla-fracture-${index}`} position={fracture} rotation={[-0.7, 0, index === 0 ? 0.3 : -0.3]}>
               <capsuleGeometry args={[1.1, 10, 4, 8]} />
               <meshStandardMaterial color="#9a3412" emissive="#fb923c" emissiveIntensity={isCritical ? 1.8 : 0.85} roughness={0.88} />
            </mesh>
          ))}
          
          {/* Massive Segmented Tail (Seamless Overhaul) */}
          {[...Array(10)].map((_, i) => {
             const tScale = 1 - i * 0.08;
             const tailSway = Math.sin(moveTime * 1.0 + i * 0.4);
             return (
               <mesh 
                 key={i} 
                 position={[tailSway * 3.5 * (i+1), 10 - i * 1.5, -20 - i * 11]} 
                 rotation={[-0.05, tailSway * 0.35, 0]}
               >
                  <sphereGeometry args={[11 * tScale, 24, 24]} scale={[1, 0.85, 1.4]} />
                  <meshStandardMaterial color="#020617" roughness={0.4} />
               </mesh>
             );
          })}
          
          {/* Sinister Predatory Head */}
          <group position={[0, 50, 10]} rotation={[0.1, 0, 0]}>
             {/* Skull */}
             <mesh position={[0, 0, 6]}>
                <sphereGeometry args={[10, 20, 20]} scale={[1, 0.85, 1.3]} />
                <meshStandardMaterial color={isHeavyWounded ? "#111827" : "#020617"} roughness={0.2} metalness={0.9} />
             </mesh>
             {/* Lower Jaw (Animated) */}
             <group ref={jawRef} position={[0, -4, 4]}>
                <mesh position={[0, -2, 4]}>
                   <boxGeometry args={[13, 6, 18]} />
                   <meshStandardMaterial color="#020617" />
                </mesh>
                {/* Teeth - rows of them */}
                {[...Array(12)].map((_, i) => (
                   <mesh key={i} position={[-6 + i * 1.1, 1, 10 - (i%2)*2]}>
                      <coneGeometry args={[0.6, 5, 4]} />
                      <meshStandardMaterial color="#ffffff" metalness={0.5} roughness={0.1} />
                   </mesh>
                ))}
             </group>
             {/* Glowing Eyes of Terror */}
             <mesh position={[6, 4, 14]}>
                <sphereGeometry args={[2.5, 12, 12]} />
                <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={isCritical ? 16 : 12} />
             </mesh>
             <mesh position={[-6, 4, 14]}>
                <sphereGeometry args={[2.5, 12, 12]} />
                <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={isCritical ? 16 : 12} />
             </mesh>
          </group>
          
          {/* Armored Legs */}
          {[[-1, 1], [1, 2]].map(([side, idx]) => (
             <group key={idx} position={[side * 14, 10, -5]}>
                {/* Thigh */}
                <mesh>
                   <sphereGeometry args={[10, 16, 16]} scale={[0.8, 1.4, 0.9]} />
                   <meshStandardMaterial color="#0f172a" />
                </mesh>
                {/* Lower Leg */}
                <mesh position={[0, -12, 4]} rotation={[0.2, 0, 0]}>
                   <cylinderGeometry args={[5, 7, 18, 16]} />
                   <meshStandardMaterial color="#020617" />
                </mesh>
                {/* Claws */}
                {[[-2, -18, 12], [2, -18, 12], [0, -18, 14]].map((cPos, ci) => (
                   <mesh key={ci} position={cPos} rotation={[Math.PI/2, 0, 0]}>
                      <coneGeometry args={[2, 8, 4]} />
                      <meshStandardMaterial color="#1a1a1a" metalness={1} />
                   </mesh>
                ))}
             </group>
          ))}
        </group>
     );
  };

  return (
    <group ref={group}>
      {renderVariant()}

      {/* HP Bar Overlay floating directly above head, adjusting for height */}
      <group ref={hpBar} position={[0, Math.max(40, 600 / (p.scale || 10)), 0]}>
         <mesh position={[0, 0, -0.1]}>
            <planeGeometry args={[20, 2]} />
            <meshBasicMaterial color="#7f1d1d" />
         </mesh>
         <mesh position={[10 * (hpPercent - 1), 0, 0]}>
            <planeGeometry args={[20 * hpPercent, 2]} />
            <meshBasicMaterial color="#22c55e" />
         </mesh>
      </group>
    </group>
  );
};

const MemoEntityKaijuAttack = memo(EntityKaijuAttack);
const MemoEntityFireBreath = memo(EntityFireBreath);
const MemoEntityBullet = memo(EntityBullet);
const MemoEntityShell = memo(EntityShell);
const MemoEntityMuzzleFlash = memo(EntityMuzzleFlash);
const MemoEntityJet = memo(EntityJet);
const MemoEntityMissile = memo(EntityMissile);
const MemoEntityMissileImpact = memo(EntityMissileImpact);
const MemoEntityImpactPuff = memo(EntityImpactPuff);
const MemoEntityPlane = memo(EntityPlane);
const MemoEntityBomb = memo(EntityBomb);
const MemoEntityBunker = memo(EntityBunker);
const MemoEntityFacility = memo(EntityFacility);
const MemoEntityBarricade = memo(EntityBarricade);
const MemoEntityKaiju = memo(EntityKaiju);
const MemoEntityKaijuCorpse = memo(EntityKaijuCorpse);

const DynamicEntitySync = memo(({ entitiesRef, entityLookupRef, frameSnapshotRef, setGameState, qualityProfile }) => {
  const [, setForceRender] = useState(0);
  const lastSignature = useRef('');
  const syncAccumulator = useRef(0);
  
  useFrame((_, delta) => {
     syncAccumulator.current += delta;
     if (syncAccumulator.current < 0.12) return;
     syncAccumulator.current = 0;
     const signature = getDynamicEntitySignature(entitiesRef.current);
     if (signature !== lastSignature.current) {
        lastSignature.current = signature;
        setForceRender(n => n + 1);
     }
  });

  return (
    <>
      {entitiesRef.current.map((p) => {
        // ONLY return dynamic entities out of the main array
        if (p.type === 'plane') return <MemoEntityPlane key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'bomb') return <MemoEntityBomb key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'kaiju') return <MemoEntityKaiju key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} frameSnapshotRef={frameSnapshotRef} setGameState={setGameState} />;
        if (p.type === 'mushroom') return <EntityMushroomCloud key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'kaiju_attack') return <MemoEntityKaijuAttack key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'firebreath') return <MemoEntityFireBreath key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'bullet') return <MemoEntityBullet key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'shell') return <MemoEntityShell key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'jet') return <MemoEntityJet key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'missile') return <MemoEntityMissile key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'missile_impact') return <MemoEntityMissileImpact key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'impact_puff') return <MemoEntityImpactPuff key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'soldier') return <EntityPerson key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'tank') return <EntityTank key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'barricade') return <MemoEntityBarricade key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'facility') return <MemoEntityFacility key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'muzzle_flash') return <MemoEntityMuzzleFlash key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'corpse') return <EntityCorpse key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'kaiju_corpse') return <MemoEntityKaijuCorpse key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'scorch') return <EntityScorch key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        return null;
      })}
    </>
  );
});

// Pre-compiles heavy WebGL shaders and geometries on mount to prevent stutter
// when these dynamic effects are first deployed in the middle of gameplay.
const DummyWarmup = memo(({ qualityProfile }) => {
  const [enabled, setEnabled] = useState(true);
  const dummyRef = useRef([
    { id: 'dummy-bomb', dead: false, x: 0, y: -5000, z: 0, age: -9999 },
    { id: 'dummy-attk', dead: false, x: 0, y: -5000, z: 0, age: -9999 }
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let rafA = 0;
    let rafB = 0;
    loadNukeCloudAsset().catch(() => {});
    loadWorldPropsAsset().catch(() => {});
    loadAirstrikeAsset().catch(() => {});
    loadBaseStructuresAsset().catch(() => {});
    loadKaijuAssetsAsset().catch(() => {});
    rafA = window.requestAnimationFrame(() => {
      rafB = window.requestAnimationFrame(() => setEnabled(false));
    });
    return () => {
      window.cancelAnimationFrame(rafA);
      window.cancelAnimationFrame(rafB);
    };
  }, []);

  if (!enabled) return null;

  return (
    <group position={[0, -5000, 0]} renderOrder={-100}>
       <MemoEntityBomb index={0} entitiesRef={dummyRef} />
       <MemoEntityKaijuAttack index={1} entitiesRef={dummyRef} />
    </group>
  );
});

const VillageScene = ({ themeConfig, setNukeCount, setGameState, pollution, qualityProfile }) => {
  const entitiesRef = useRef([]);
  const entityLookupRef = useRef(new Map());
  const [mounted, setMounted] = useState(false);
  const { camera, gl } = useThree();
  const originalCamPos = useRef(new THREE.Vector3(0, 400, 600));
  const zoomLevel = useRef(0.6); // Start wider for the bigger map
  const targetZoom = useRef(0.6);
  const moveOffset = useRef({ x: 0, z: 0 }); 
  const keys = useRef({});
  const cameraRotation = useRef({ yaw: 0, pitch: Math.PI / 4 }); // Start at 45 degree tilt
  const isRightClickDragging = useRef(false);
  const targetingRef = useRef({
    isStrikeInProgress: false,
    confirmedTarget: null,
    cooldownUntil: 0,
    manualStrikeArmed: false,
    pendingDeploy: null,
    pendingBuild: null
  });
  const waveRef = useRef({
    level: 1,
    totalLevels: TOTAL_KAIJU_LEVELS,
    transitioning: false,
    nextWaveAt: 0,
    nextLevel: 1,
    clearHandled: false
  });
  const economyRef = useRef({
    credits: STARTING_COMMAND_CREDITS,
    lastIncomeAt: 0,
    incomeBonus: 0,
    buildings: cloneDefaultBuildings(),
    buildQueue: cloneDefaultBuildQueue(),
    upgrades: cloneDefaultUpgrades(),
    tankDamageMultiplier: 1,
    tankReloadMultiplier: 1
  });
  const deployDragRef = useRef({
    active: false,
    target: null
  });
  const pointerRaycasterRef = useRef(new THREE.Raycaster());
  const pointerNdcRef = useRef(new THREE.Vector2());
  const buildDragRef = useRef({
    active: false,
    target: null
  });
  const bombCamRef = useRef({
    active: false,
    bombId: null,
    smoothedLookAt: new THREE.Vector3(),
    smoothedPosition: new THREE.Vector3()
  });
  const currentSectorNameRef = useRef(formatSectorName(themeConfig?.name || 'village'));
  const nextSectorNameRef = useRef(pickRandomSectorName(themeConfig?.name || 'village'));
  const frameSnapshotRef = useRef(createFrameEntitySnapshot());

  const getAliveBunkers = () => (
    frameSnapshotRef.current.ready
      ? frameSnapshotRef.current.aliveBunkers
      : entitiesRef.current.filter(e => e.type === 'bunker' && !e.dead && !isBrokenStructure(e))
  );
  const getAliveKaijus = () => (
    frameSnapshotRef.current.ready
      ? frameSnapshotRef.current.aliveKaijus
      : entitiesRef.current.filter(e => e.type === 'kaiju' && !isKaijuDefeated(e))
  );
  const getAliveBarricades = () => (
    frameSnapshotRef.current.ready
      ? frameSnapshotRef.current.liveBarricades
      : entitiesRef.current.filter(e => e.type === 'barricade' && !e.dead)
  );
  const rebuildFrameSnapshot = () => {
    const snapshot = frameSnapshotRef.current;
    entityLookupRef.current.clear();
    snapshot.ready = true;
    snapshot.allKaijus.length = 0;
    snapshot.aliveKaijus.length = 0;
    snapshot.groundKaijus.length = 0;
    snapshot.flyingKaijus.length = 0;
    snapshot.allBunkers.length = 0;
    snapshot.aliveBunkers.length = 0;
    snapshot.liveBarricades.length = 0;
    snapshot.liveFacilities.length = 0;
    snapshot.aaSites.length = 0;
    snapshot.liveTanks.length = 0;
    snapshot.liveJets.length = 0;
    snapshot.liveSoldiers.length = 0;
    snapshot.liveEngineers.length = 0;
    snapshot.livePersons.length = 0;
    snapshot.repairTargets.length = 0;
    snapshot.collateralTargets.length = 0;

    entitiesRef.current.forEach((entity) => {
      if (!entity) return;
      entityLookupRef.current.set(entity.id, entity);

      if (!entity.dead && entity.type !== 'kaiju' && entity.type !== 'scorch' && entity.type !== 'bomb' && entity.type !== 'bunker') {
        snapshot.collateralTargets.push(entity);
      }

      if (entity.type === 'kaiju') {
        snapshot.allKaijus.push(entity);
        if (!isKaijuDefeated(entity)) {
          snapshot.aliveKaijus.push(entity);
          if (isFlyingKaiju(entity)) snapshot.flyingKaijus.push(entity);
          else snapshot.groundKaijus.push(entity);
        }
        return;
      }

      if (entity.type === 'bunker') {
        snapshot.allBunkers.push(entity);
        if (!entity.dead && !isBrokenStructure(entity)) {
          snapshot.aliveBunkers.push(entity);
          if ((entity.hp || 0) < (entity.maxHp || BUNKER_BASE_HP)) {
            snapshot.repairTargets.push(entity);
          }
        }
        return;
      }

      if (entity.dead) return;

      if (entity.type === 'facility') {
        if (isBrokenStructure(entity)) return;
        snapshot.liveFacilities.push(entity);
        if (entity.kind === 'aa_site') snapshot.aaSites.push(entity);
        if ((entity.hp || 0) < (entity.maxHp || 1000)) snapshot.repairTargets.push(entity);
        return;
      }

      if (entity.type === 'barricade') {
        snapshot.liveBarricades.push(entity);
        if ((entity.hp || 0) < (entity.maxHp || BARRICADE_MAX_HP)) snapshot.repairTargets.push(entity);
        return;
      }

      if (entity.type === 'tank') {
        snapshot.liveTanks.push(entity);
        if ((entity.hp || 0) < (entity.maxHp || TANK_BASE_HP)) snapshot.repairTargets.push(entity);
        return;
      }

      if (entity.type === 'jet') {
        snapshot.liveJets.push(entity);
        return;
      }

      if (entity.type === 'soldier') {
        snapshot.liveSoldiers.push(entity);
        if (entity.weaponType === 'engineer') snapshot.liveEngineers.push(entity);
        return;
      }

      if (entity.type === 'person') {
        snapshot.livePersons.push(entity);
      }
    });

    return snapshot;
  };
  const clearDeployDrag = () => {
    deployDragRef.current.active = false;
    deployDragRef.current.target = null;
    window._falloutDeployDragActive = false;
    window._falloutDeployDragTarget = null;
  };
  const setDeployDragTarget = (target) => {
    deployDragRef.current.target = target;
    window._falloutDeployDragTarget = target;
  };
  const clearBuildDrag = () => {
    buildDragRef.current.active = false;
    buildDragRef.current.target = null;
    window._falloutBuildDragActive = false;
    window._falloutBuildDragTarget = null;
    window._falloutBuildPlacementValid = false;
  };
  const setBuildDragTarget = (target) => {
    buildDragRef.current.target = target;
    window._falloutBuildDragTarget = target;
  };
  const clearBombCam = () => {
    bombCamRef.current.active = false;
    bombCamRef.current.bombId = null;
    window._falloutBombCamActive = false;
    window._falloutBombCamBombId = null;
  };
  const activateBombCam = (bomb) => {
    if (!bomb?.isManual) return;
    bombCamRef.current.active = true;
    bombCamRef.current.bombId = bomb.id;
    bombCamRef.current.smoothedPosition.set(bomb.x, bomb.y || 0, bomb.z);
    bombCamRef.current.smoothedLookAt.set(bomb.x, bomb.y || 0, bomb.z - 40);
    window._falloutBombCamActive = true;
    window._falloutBombCamBombId = bomb.id;
  };
  const getBestDeployBunker = () => {
    const aliveBunkers = getAliveBunkers();
    if (!aliveBunkers.length) return null;
    return [...aliveBunkers].sort((a, b) => b.hp - a.hp)[0];
  };
  const getDeployUnlocks = () => getDeployUnlockState(economyRef.current.buildings);
  const isDeployUnlocked = (unitType) => !!getDeployUnlocks()[unitType];
  const getBuildPlacementBlockRadius = (entity) => {
    if (!entity) return FACILITY_BUILD_MIN_SPACING;
    if (entity.type === 'bunker') return FACILITY_BUILD_MIN_SPACING + 26;
    if (entity.type === 'facility') {
      if (entity.kind === 'war_factory') return FACILITY_BUILD_MIN_SPACING + 40;
      if (entity.kind === 'powerplant') return FACILITY_BUILD_MIN_SPACING + 28;
      return FACILITY_BUILD_MIN_SPACING + 18;
    }
    if (entity.type === 'barricade') return 22;
    return FACILITY_BUILD_MIN_SPACING;
  };
  const validateBuildingPlacementCandidate = (target, bunker = getBestDeployBunker()) => {
    if (!target) return { ok: false };
    const clamped = clampStrikeTarget(target);
    if (!bunker) return { ok: false };
    const distFromBunker = Math.hypot(clamped.x - bunker.x, clamped.z - bunker.z);
    if (distFromBunker < FACILITY_BUILD_MIN_DISTANCE || distFromBunker > FACILITY_BUILD_MAX_DISTANCE) {
      return { ok: false, target: clamped, bunker };
    }
    const blockedByStructure = entitiesRef.current.some((entity) => {
      if (entity.type !== 'facility' && entity.type !== 'bunker' && entity.type !== 'barricade') return false;
      if (entity.type === 'barricade' && entity.dead) return false;
      return Math.hypot(entity.x - clamped.x, entity.z - clamped.z) < getBuildPlacementBlockRadius(entity);
    });
    if (blockedByStructure) return { ok: false, target: clamped, bunker };
    return { ok: true, target: clamped, bunker };
  };
  const findNearestValidBuildingPlacement = (target, bunker) => {
    const base = validateBuildingPlacementCandidate(target, bunker);
    if (base.ok) return base;
    const center = base.target || clampStrikeTarget(target);
    const angleSteps = 18;
    for (let radius = 28; radius <= 260; radius += 24) {
      for (let i = 0; i < angleSteps; i++) {
        const angle = (i / angleSteps) * Math.PI * 2;
        const candidate = validateBuildingPlacementCandidate({
          x: center.x + Math.cos(angle) * radius,
          z: center.z + Math.sin(angle) * radius
        }, bunker);
        if (candidate.ok) return { ...candidate, snapped: true };
      }
    }
    return base;
  };
  const validateBuildingPlacement = (target, { snap = true } = {}) => {
    if (!target) return { ok: false };
    const bunker = getBestDeployBunker();
    if (!bunker) return { ok: false };
    const direct = validateBuildingPlacementCandidate(target, bunker);
    if (direct.ok || !snap) return direct;
    return findNearestValidBuildingPlacement(direct.target || target, bunker);
  };
  const canPurchaseBuilding = (buildingKey) => {
    const option = BUILD_OPTIONS[buildingKey];
    if (!option) return false;
    if (economyRef.current.buildings[buildingKey]) return false;
    if (economyRef.current.buildQueue?.[buildingKey]) return false;
    if (!hasPrerequisites(getBuildPlacementState(economyRef.current.buildings, economyRef.current.buildQueue), option.requires || [])) return false;
    if (economyRef.current.credits < option.cost) return false;
    return true;
  };
  const canPurchaseUpgrade = (upgradeKey) => {
    const option = UPGRADE_OPTIONS[upgradeKey];
    if (!option) return false;
    if (economyRef.current.upgrades[upgradeKey]) return false;
    if (!hasPrerequisites(economyRef.current.buildings, option.requires || [])) return false;
    if (economyRef.current.credits < option.cost) return false;
    return true;
  };
  const addCredits = (amount) => {
    economyRef.current.credits = Math.min(COMMAND_CREDIT_CAP, economyRef.current.credits + amount);
  };
  const spendCommandCredits = (amount) => {
    if (economyRef.current.credits < amount) return false;
    economyRef.current.credits -= amount;
    return true;
  };
  const queueDeployFeedback = (ok = true) => {
    AudioManager.play(ok ? 'target_confirm' : 'target_blocked', ok ? { volume: 0.08, duration: 0.12 } : { volume: 0.08, duration: 0.12 });
  };
  const spawnSquadFromBunker = (bunker, target) => {
    const angle = getDeployAngle(bunker, target);
    for (let i = 0; i < 4; i++) {
      const soldier = applySoldierTrainingBonuses(
        createSoldierReinforcement(`soldier-deploy-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`, bunker, i),
        economyRef.current.upgrades
      );
      soldier.vx = Math.cos(angle) * (soldier.combatSpeed || 2.6);
      soldier.vz = Math.sin(angle) * (soldier.combatSpeed || 2.6);
      soldier.aimAngle = angle;
      soldier.state = 'walking';
      soldier.commandTargetX = target.x;
      soldier.commandTargetZ = target.z;
      entitiesRef.current.push(soldier);
    }
  };
  const spawnSpecialistTeamFromBunker = (bunker, target, config = {}) => {
    const {
      count = 3,
      loadoutKey = 'rifleman',
      spreadStep = 0.34
    } = config;
    const angle = getDeployAngle(bunker, target);
    for (let i = 0; i < count; i++) {
      const soldier = applySoldierTrainingBonuses(
        createSpecialistSoldier(
          `soldier-special-${loadoutKey}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          bunker,
          i,
          loadoutKey
        ),
        economyRef.current.upgrades
      );
      const formationOffset = (i - (count - 1) / 2) * spreadStep;
      soldier.x += Math.cos(angle + Math.PI / 2) * formationOffset * 18;
      soldier.z += Math.sin(angle + Math.PI / 2) * formationOffset * 18;
      soldier.vx = Math.cos(angle) * (soldier.combatSpeed || 2.6);
      soldier.vz = Math.sin(angle) * (soldier.combatSpeed || 2.6);
      soldier.aimAngle = angle;
      soldier.state = 'walking';
      soldier.commandTargetX = target.x;
      soldier.commandTargetZ = target.z;
      entitiesRef.current.push(soldier);
    }
  };
  const spawnTankFromBunker = (bunker, target) => {
    const tank = createTankReinforcement(
      `tank-deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      bunker,
      {
        damageMultiplier: economyRef.current.tankDamageMultiplier || 1,
        reloadMultiplier: economyRef.current.tankReloadMultiplier || 1
      }
    );
    const angle = getDeployAngle(bunker, target);
    const speed = 3.2 * (tank.speedMultiplier || 1);
    tank.vx = Math.cos(angle) * speed;
    tank.vz = Math.sin(angle) * speed;
    tank.rotation = angle - Math.PI / 2;
    tank.commandTargetX = target.x;
    tank.commandTargetZ = target.z;
    entitiesRef.current.push(tank);
  };
  const spawnAPCFromBunker = (bunker, target) => {
    const tank = createTankReinforcement(
      `apc-deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      bunker,
      {
        variant: 'apc',
        scale: 1.02,
        speedMultiplier: APC_SPEED_MULTIPLIER,
        damageMultiplier: (economyRef.current.tankDamageMultiplier || 1) * APC_DAMAGE_MULTIPLIER,
        reloadMultiplier: (economyRef.current.tankReloadMultiplier || 1) * APC_RELOAD_MULTIPLIER
      }
    );
    const angle = getDeployAngle(bunker, target);
    const speed = 3.35 * (tank.speedMultiplier || 1);
    tank.vx = Math.cos(angle) * speed;
    tank.vz = Math.sin(angle) * speed;
    tank.rotation = angle - Math.PI / 2;
    tank.commandTargetX = target.x;
    tank.commandTargetZ = target.z;
    entitiesRef.current.push(tank);
  };
  const spawnBarricade = (bunker, target) => {
    entitiesRef.current.push(createBarricadeEntity(`barricade-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, bunker, target));
  };
  const purchaseBuilding = (buildingKey, target = null) => {
    const option = BUILD_OPTIONS[buildingKey];
    if (!option || !canPurchaseBuilding(buildingKey)) return false;
    const placement = validateBuildingPlacement(
      target || window._falloutBuildPlacementTarget || { x: getBestDeployBunker()?.x || 0, z: (getBestDeployBunker()?.z || 0) - 130 },
      { snap: true }
    );
    if (!placement.ok || !placement.target || !placement.bunker) return false;
    if (!spendCommandCredits(option.cost)) return false;
    economyRef.current.buildQueue[buildingKey] = true;
    const facility = createFacilityEntity(
      `facility-${buildingKey}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      buildingKey,
      placement.bunker,
      Object.keys(BUILD_OPTIONS).indexOf(buildingKey),
      placement.target
    );
    facility.constructing = true;
    facility.buildProgress = 0;
    facility.buildElapsed = 0;
    facility.buildDuration = FACILITY_BUILD_DURATION + Math.random() * 1.2;
    entitiesRef.current.push(facility);
    window._falloutLastBuildTarget = placement.target;
    window._falloutBuildPlacementTarget = placement.target;
    queueDeployFeedback(true);
    return true;
  };
  const purchaseUpgrade = (upgradeKey) => {
    const option = UPGRADE_OPTIONS[upgradeKey];
    if (!option || !canPurchaseUpgrade(upgradeKey)) return false;
    if (!spendCommandCredits(option.cost)) return false;
    economyRef.current.upgrades[upgradeKey] = true;
    if (upgradeKey === 'tank_mk2') {
      economyRef.current.tankDamageMultiplier = TANK_MK2_DAMAGE_MULTIPLIER;
      economyRef.current.tankReloadMultiplier = TANK_MK2_RELOAD_MULTIPLIER;
      entitiesRef.current.forEach((entity) => {
        if (entity.type === 'tank' && !entity.dead) {
          entity.damageMultiplier = Math.max(entity.damageMultiplier || 1, TANK_MK2_DAMAGE_MULTIPLIER);
          entity.reloadMultiplier = Math.max(entity.reloadMultiplier || 1, TANK_MK2_RELOAD_MULTIPLIER);
        }
      });
    } else if (upgradeKey === 'ranger_drill') {
      entitiesRef.current.forEach((entity) => {
        if (entity.type === 'soldier' && !entity.dead) {
          applySoldierTrainingBonuses(entity, economyRef.current.upgrades);
        }
      });
    }
    queueDeployFeedback(true);
    return true;
  };
  const launchJetSupport = () => {
    const targetKaiju = getAliveKaijus().sort((a, b) => {
      const aRatio = a.hp / a.maxHp;
      const bRatio = b.hp / b.maxHp;
      return aRatio - bRatio;
    })[0];
    if (!targetKaiju) return false;
    entitiesRef.current.push(createJetReinforcement(`jet-deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, targetKaiju));
    AudioManager.play('plane_engine', { volume: 0.12, duration: 0.45 });
    return true;
  };
  const clearPendingStrikeArm = () => {
    targetingRef.current.manualStrikeArmed = false;
    window._falloutManualStrikeArmed = false;
  };
  const setPendingStrikeArm = () => {
    targetingRef.current.manualStrikeArmed = true;
    targetingRef.current.pendingDeploy = null;
    targetingRef.current.pendingBuild = null;
    window._falloutManualStrikeArmed = true;
    window._falloutPendingDeploy = null;
    window._falloutPendingBuild = null;
    window._falloutTargetConfirmedFlash = false;
    clearDeployDrag();
    clearBuildDrag();
  };
  const setPendingDeploy = (unitType) => {
    targetingRef.current.pendingDeploy = unitType;
    targetingRef.current.pendingBuild = null;
    clearPendingStrikeArm();
    window._falloutPendingDeploy = unitType;
    window._falloutPendingBuild = null;
    window._falloutTargetConfirmedFlash = false;
    clearDeployDrag();
    clearBuildDrag();
  };
  const clearPendingDeploy = () => {
    targetingRef.current.pendingDeploy = null;
    window._falloutPendingDeploy = null;
    clearDeployDrag();
  };
  const setPendingBuild = (buildingKey) => {
    targetingRef.current.pendingBuild = buildingKey;
    targetingRef.current.pendingDeploy = null;
    clearPendingStrikeArm();
    window._falloutPendingBuild = buildingKey;
    window._falloutPendingDeploy = null;
    window._falloutTargetConfirmedFlash = false;
    if (window._falloutBuildPlacementTarget) {
      window._falloutBuildFallbackTarget = window._falloutBuildPlacementTarget;
    } else if (window._falloutLastBuildTarget) {
      window._falloutBuildFallbackTarget = window._falloutLastBuildTarget;
    } else if (window._falloutMouseTarget) {
      window._falloutBuildFallbackTarget = window._falloutMouseTarget;
    } else {
      const bunker = getBestDeployBunker();
      if (bunker) {
        window._falloutBuildFallbackTarget = clampStrikeTarget({ x: bunker.x + 150, z: bunker.z + 120 });
      }
    }
    clearDeployDrag();
    clearBuildDrag();
  };
  const clearPendingBuild = () => {
    targetingRef.current.pendingBuild = null;
    window._falloutPendingBuild = null;
    clearBuildDrag();
  };
  const spawnKaijuWave = (level, targetEntities = entitiesRef.current) => {
    const maxKaijus = Math.max(1, qualityProfile?.kaijuMax ?? 3);
    const numKaijus = getWaveKaijuCount(level, maxKaijus);
    const variants = getKaijuVariantPoolForLevel(level);
    const kaijuPositions = [];
    const minKaijuSeparation = 360;
    const hpScale = 1 + (level - 1) * 0.16;

    for (let i = 0; i < numKaijus; i++) {
      const variant = variants[Math.floor(Math.random() * variants.length)];
      const variantConfig = KAIJU_VARIANT_CONFIG[variant] || KAIJU_VARIANT_CONFIG.godzilla;
      let angle;
      let radius;
      let x;
      let z;
      let attempts = 0;
      let tooClose;

      do {
        angle = Math.random() * Math.PI * 2;
        radius = 620 + Math.random() * 440 + level * 18;
        x = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
        tooClose = false;

        for (const pos of kaijuPositions) {
          const dx = x - pos.x;
          const dz = z - pos.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < minKaijuSeparation) {
            tooClose = true;
            break;
          }
        }
        attempts++;
      } while (tooClose && attempts < 60);

      kaijuPositions.push({ x, z });
      const maxHp = Math.round(KAIJU_BASE_HP * variantConfig.hpMult * hpScale);
      const spawnY = getKaijuSpawnY(variant, x, z, false);
      targetEntities.push({
        id: `kaiju-l${level}-${Date.now()}-${i}`,
        type: 'kaiju',
        variant,
        x,
        y: spawnY,
        z,
        hp: maxHp,
        maxHp,
        scale: variantConfig.scaleMin + Math.random() * (variantConfig.scaleMax - variantConfig.scaleMin),
        level,
        flightBaseHeight: isFlyingKaijuVariant(variant) ? spawnY : undefined,
        flightPhase: Math.random() * Math.PI * 2,
        dead: false
      });
    }

    const miniCount = Math.min(5, Math.max(0, level - 1 + (Math.random() < 0.55 ? 1 : 0)));
    for (let i = 0; i < miniCount; i++) {
      const variant = variants[Math.floor(Math.random() * variants.length)];
      const variantConfig = KAIJU_VARIANT_CONFIG[variant] || KAIJU_VARIANT_CONFIG.godzilla;
      const angle = Math.random() * Math.PI * 2;
      const radius = 360 + Math.random() * 260;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const maxHp = Math.round(KAIJU_BASE_HP * 0.17 * variantConfig.hpMult * (1 + (level - 1) * 0.08));
      const spawnY = getKaijuSpawnY(variant, x, z, true);
      targetEntities.push({
        id: `mini-kaiju-l${level}-${Date.now()}-${i}`,
        type: 'kaiju',
        variant,
        x,
        y: spawnY,
        z,
        hp: maxHp,
        maxHp,
        scale: Math.max(1.35, variantConfig.scaleMin * 0.4 + Math.random() * 0.65),
        level,
        isMini: true,
        displayName: `mini ${getKaijuDisplayName(variant)}`,
        flightBaseHeight: isFlyingKaijuVariant(variant) ? spawnY : undefined,
        flightPhase: Math.random() * Math.PI * 2,
        dead: false
      });
    }

    waveRef.current.level = level;
  };
  const rewardForWaveClear = (clearedLevel) => {
    const creditReward = LEVEL_CLEAR_CREDIT_REWARD + clearedLevel * 18;
    addCredits(creditReward);
    getAliveBunkers().forEach((bunker) => {
      bunker.hp = Math.min(bunker.maxHp, bunker.hp + LEVEL_CLEAR_BUNKER_REPAIR + clearedLevel * 22);
    });
  };
  const pruneDefeatedKaijus = () => {
    entitiesRef.current = entitiesRef.current.filter((entity) => {
      if (entity?.type !== 'kaiju') return true;
      return !isKaijuDefeated(entity);
    });
    if (entitiesRef.current._victoryTriggered === undefined) entitiesRef.current._victoryTriggered = false;
    if (entitiesRef.current._defeatTriggered === undefined) entitiesRef.current._defeatTriggered = false;
  };

  useEffect(() => {
    const handleKeyDown = (e) => { keys.current[e.code] = true; };
    const handleKeyUp = (e) => { keys.current[e.code] = false; };
    
    const handleMouseDown = (e) => {
       if (e.button === 2) isRightClickDragging.current = true; // Right click
    };
    const handleMouseUp = (e) => {
       if (e.button === 2) isRightClickDragging.current = false;
       const canvas = gl?.domElement;
       const cameFromCanvas = !!canvas && e.target === canvas;
       if (e.button === 0 && !cameFromCanvas && targetingRef.current.pendingDeploy && deployDragRef.current.active) {
         if (deployDragRef.current.target) deployManualStrike(deployDragRef.current.target);
         clearDeployDrag();
       }
    };
    const handleMouseMove = (e) => {
       if (isRightClickDragging.current) {
          cameraRotation.current.yaw -= e.movementX * 0.005;
          cameraRotation.current.pitch = Math.max(0.1, Math.min(Math.PI / 2.1, cameraRotation.current.pitch + e.movementY * 0.005));
       }
    };
    const handleContextMenu = (e) => {
       e.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('contextmenu', handleContextMenu);
    
    return () => {
       window.removeEventListener('keydown', handleKeyDown);
       window.removeEventListener('keyup', handleKeyUp);
       window.removeEventListener('mousedown', handleMouseDown);
       window.removeEventListener('mouseup', handleMouseUp);
       window.removeEventListener('mousemove', handleMouseMove);
       window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [gl]);

  useEffect(() => {
    if (!themeConfig) return;

    currentSectorNameRef.current = formatSectorName(themeConfig?.name || 'village');
    nextSectorNameRef.current = pickRandomSectorName(themeConfig?.name || 'village');

    const initial = [];
    const civilianCount = Math.max(0, Math.round(themeConfig.population * 2 * (qualityProfile?.civilianDensity ?? 1)));
    const houseCount = Math.max(0, Math.round(themeConfig.houseCount * 1.5 * (qualityProfile?.structureDensity ?? 1)));
    const treeCount = Math.max(0, Math.round(themeConfig.treeCount * 1.5 * (qualityProfile?.treeDensity ?? 1)));
    const birdCount = Math.max(0, Math.round(themeConfig.birdCount * 1.5 * (qualityProfile?.birdDensity ?? 1)));

    for (let i = 0; i < civilianCount; i++) initial.push(createPerson(`p${i}`, themeConfig));
    for (let i = 0; i < houseCount; i++) initial.push(createHouse(`h${i}`, themeConfig));
    for (let i = 0; i < treeCount; i++) initial.push(createTree(`t${i}`, themeConfig));
    for (let i = 0; i < birdCount; i++) initial.push(createBird(`b${i}`, themeConfig));
    spawnKaijuWave(1, initial);
    
    // Spawn military tanks from all directions when kaiju appears
    const tankDirections = [
      { x: -WORLD_WIDTH/2 - 200, z: 0, vx: 5, vz: 0 },
      { x: WORLD_WIDTH/2 + 200, z: 0, vx: -5, vz: 0 },
      { x: 0, z: -WORLD_DEPTH/2 - 200, vx: 0, vz: 5 },
      { x: 0, z: WORLD_DEPTH/2 + 200, vx: 0, vz: -5 },
      { x: -WORLD_WIDTH/2 - 150, z: -WORLD_DEPTH/2 - 150, vx: 4, vz: 4 },
      { x: WORLD_WIDTH/2 + 150, z: WORLD_DEPTH/2 + 150, vx: -4, vz: -4 },
    ];
    const reinforcementCount = Math.max(2, Math.min(tankDirections.length, Math.round(tankDirections.length * (qualityProfile?.militaryDensity ?? 1))));
    tankDirections.slice(0, reinforcementCount).forEach((dir, i) => {
        initial.push({
            id: `tank-reinforce-${Date.now()}-${i}`,
            type: 'tank',
            x: dir.x,
            z: dir.z,
            y: getTerrainHeight(dir.x, dir.z),
            vx: dir.vx,
            vz: dir.vz,
            scale: 1.2,
            state: 'driving',
            reloadTimer: Math.random() * 3.0, // Stagger initial firing so they don't fire at once
            hp: TANK_BASE_HP,
            maxHp: TANK_BASE_HP,
            dead: false
        });
    });

    initial.forEach(p => {
       if (p.type === 'person') {
          if (Math.random() < 0.16) applySoldierLoadout(p, p.id.length + Math.floor(Math.random() * 9));
       }
       // Final Height Sync
       if (p.y === 0 || p.y === undefined) p.y = getTerrainHeight(p.x, p.z);
    });

    // Spawn 4 Scattered Bunkers
    const bunkerPos = [[120, 120], [-120, 120], [120, -120], [-120, -120]];
    bunkerPos.forEach((pos, i) => {
        initial.push({
           id: `bunker-${i}`, type: 'bunker',
           x: pos[0], y: getTerrainHeight(pos[0], pos[1]), z: pos[1],
           hp: BUNKER_BASE_HP, maxHp: BUNKER_BASE_HP,
           state: 'intact',
           destroyed: false,
           dead: false
        });
    });

    initial._victoryTriggered = false;
    initial._defeatTriggered = false;
    entitiesRef.current = initial;
    waveRef.current.level = 1;
    waveRef.current.transitioning = false;
    waveRef.current.nextWaveAt = 0;
    waveRef.current.nextLevel = 1;
    waveRef.current.clearHandled = false;
    economyRef.current.credits = STARTING_COMMAND_CREDITS;
    economyRef.current.lastIncomeAt = 0;
    economyRef.current.incomeBonus = 0;
    economyRef.current.buildings = cloneDefaultBuildings();
    economyRef.current.buildQueue = cloneDefaultBuildQueue();
    economyRef.current.upgrades = cloneDefaultUpgrades();
    economyRef.current.tankDamageMultiplier = 1;
    economyRef.current.tankReloadMultiplier = 1;
    targetingRef.current.isStrikeInProgress = false;
    targetingRef.current.confirmedTarget = null;
    targetingRef.current.cooldownUntil = 0;
    targetingRef.current.manualStrikeArmed = false;
    targetingRef.current.pendingDeploy = null;
    targetingRef.current.pendingBuild = null;
    window._falloutConfirmedTarget = null;
    window._falloutStrikeCooldownRemaining = 0;
    window._falloutManualStrikeInFlight = false;
    window._falloutManualStrikeArmed = false;
    window._falloutBombCamActive = false;
    window._falloutBombCamBombId = null;
    window._falloutDeployCosts = DEPLOY_OPTIONS;
    window._falloutBuildOptions = BUILD_OPTIONS;
    window._falloutUpgradeOptions = UPGRADE_OPTIONS;
    window._falloutDeployUnlocks = getDeployUnlockState(cloneDefaultBuildings());
    window._falloutBuildState = cloneDefaultBuildings();
    window._falloutBuildQueue = cloneDefaultBuildQueue();
    window._falloutUpgradeState = cloneDefaultUpgrades();
    window._falloutPendingDeploy = null;
    window._falloutPendingBuild = null;
    window._falloutDeployAnchor = null;
    window._falloutDeployDragActive = false;
    window._falloutDeployDragTarget = null;
    window._falloutBuildDragActive = false;
    window._falloutBuildDragTarget = null;
    window._falloutBuildFallbackTarget = null;
    window._falloutBuildPlacementTarget = null;
    window._falloutLastBuildTarget = null;
    clearBombCam();
    clearDeployDrag();
    clearBuildDrag();
    setMounted(true);
  }, [themeConfig]);

  const getManualStrikeCooldownRemaining = () => (
    Math.max(0, targetingRef.current.cooldownUntil - Date.now())
  );

  const hasActiveManualStrike = () => (
    entitiesRef.current.some(e => (e.type === 'plane' || e.type === 'bomb') && e.isManual && !e.dead)
  );

  const canLaunchManualStrike = () => {
    if (targetingRef.current.isStrikeInProgress) return false;
    if (hasActiveManualStrike()) return false;
    if (getManualStrikeCooldownRemaining() > 0) return false;
    return true;
  };
  const canArmManualStrike = () => (
    canLaunchManualStrike() && economyRef.current.credits >= MANUAL_STRIKE_COST
  );

  const setConfirmedTarget = (target) => {
    targetingRef.current.confirmedTarget = target;
    window._falloutConfirmedTarget = target;
  };

  const clearConfirmedTarget = () => {
    targetingRef.current.confirmedTarget = null;
    window._falloutConfirmedTarget = null;
  };

  const launchManualStrike = (target, config = {}) => {
    if (!target) return false;

    const clampedTarget = clampStrikeTarget(target);
    clearPendingDeploy();
    clearPendingBuild();
    if (!canLaunchManualStrike()) {
      clearPendingStrikeArm();
      AudioManager.play('target_blocked');
      return false;
    }
    if (!spendCommandCredits(MANUAL_STRIKE_COST)) {
      clearPendingStrikeArm();
      AudioManager.play('target_blocked');
      return false;
    }
    clearPendingStrikeArm();

    const plane = createPlaneStrikeEntity({
      idPrefix: config.idPrefix || 'plane-manual',
      dropX: clampedTarget.x,
      dropZ: clampedTarget.z,
      speed: config.speed || 7,
      isManual: true
    });

    entitiesRef.current.push(plane);
    targetingRef.current.isStrikeInProgress = true;
    setConfirmedTarget(clampedTarget);
    window._nukeInteractionTriggered = true;
    window._falloutTargetConfirmedFlash = true;
    window._falloutManualStrikeInFlight = true;
    window._falloutStrikeCooldownRemaining = 0;
    if (cutsceneTimer.current > 0) cutsceneTimer.current = 0.1;
    AudioManager.play('target_confirm');
    AudioManager.play('missile_launch');
    AudioManager.play('plane_engine', { volume: 0.24, duration: 1.35 });
    AudioManager.play('plane_flyby', { volume: 0.11, duration: 1.4 });
    setTimeout(() => { window._falloutTargetConfirmedFlash = false; }, 500);
    return true;
  };

  useEffect(() => {
    if (!themeConfig) return;

    const spawnPlaneStrike = (config) => {
      const plane = createPlaneStrikeEntity(config);
      entitiesRef.current.push(plane);
      debugAirstrikeLog(
        `SPAWNED PLANE ${plane.id} at (${plane.x.toFixed(0)}, ${plane.z.toFixed(0)}) targeting (${plane.dropX.toFixed(0)}, ${plane.dropZ.toFixed(0)})`
      );
      AudioManager.play('plane_engine', { volume: 0.2, duration: 1.0 });
      return plane;
    };

    const handleStrikeRequest = (e) => {
      const { x: screenX, y: screenY } = e.detail;
      const vec = new THREE.Vector3();
      const pos = new THREE.Vector3();
      vec.set((screenX / window.innerWidth) * 2 - 1, -(screenY / window.innerHeight) * 2 + 1, 0.5);
      vec.unproject(camera);
      vec.sub(camera.position).normalize();
      const ray = new THREE.Ray(camera.position.clone(), vec.clone());
      const terrainPoint = getTerrainPointFromRay(ray);
      if (terrainPoint) {
        pos.set(terrainPoint.x, terrainPoint.y, terrainPoint.z);
      } else {
        const safeY = Math.abs(vec.y) < 0.001 ? (vec.y < 0 ? -0.001 : 0.001) : vec.y;
        const distance = -camera.position.y / safeY;
        pos.copy(camera.position).add(vec.multiplyScalar(distance));
        pos.y = getTerrainHeight(pos.x, pos.z);
      }
      
      window._nukeInteractionTriggered = true;
      if (cutsceneTimer.current > 0) cutsceneTimer.current = 0.1;
      launchManualStrike({ x: pos.x, z: pos.z }, { idPrefix: 'plane-manual', speed: 7 });
    };

    // Separate handler for airstrike — spawns a bomber plane from ANY 360 direction
    const handleAirstrike = () => {
      if (!canLaunchManualStrike()) return;
      // Target a random strike zone in the middle of the village
      const dropX = (Math.random() - 0.5) * (WORLD_WIDTH * 0.7);
      const dropZ = (Math.random() - 0.5) * (WORLD_DEPTH * 0.7);
      launchManualStrike({ x: dropX, z: dropZ }, { idPrefix: 'plane-manual', speed: 7 });
    };

    const handleWheel = (e) => {
       targetZoom.current = Math.max(0.4, Math.min(3.0, targetZoom.current - e.deltaY * 0.001));
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    
    window.addEventListener('fallout-strike-request', handleStrikeRequest);
    window.addEventListener('fallout-airstrike', handleAirstrike);
    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('fallout-strike-request', handleStrikeRequest);
      window.removeEventListener('fallout-airstrike', handleAirstrike);
    };
  }, [themeConfig, camera, setNukeCount]);

  useEffect(() => {
    if (!themeConfig) return;

    const handleDeploySelection = (event) => {
      const unitType = event?.detail?.unitType;
      const option = DEPLOY_OPTIONS[unitType];
      if (!option) return;
      if (!isDeployUnlocked(unitType)) {
        queueDeployFeedback(false);
        clearPendingDeploy();
        return;
      }
      if (unitType === 'jet') {
        if (!getAliveKaijus().length || economyRef.current.credits < option.cost) {
          queueDeployFeedback(false);
          clearPendingDeploy();
          return;
        }
        window.dispatchEvent(new CustomEvent('fallout-deploy-unit', { detail: { unitType } }));
        return;
      }
      if (!getBestDeployBunker() || !getAliveKaijus().length || economyRef.current.credits < option.cost) {
        queueDeployFeedback(false);
        clearPendingDeploy();
        return;
      }
      const nextPending = targetingRef.current.pendingDeploy === unitType ? null : unitType;
      if (nextPending) setPendingDeploy(nextPending);
      else clearPendingDeploy();
    };

    const handleDeployRequest = (event) => {
      const unitType = event?.detail?.unitType;
      const target = event?.detail?.target;
      const option = DEPLOY_OPTIONS[unitType];
      if (!option) return;
      if (!isDeployUnlocked(unitType)) {
        queueDeployFeedback(false);
        clearPendingDeploy();
        return;
      }

      const bunker = getBestDeployBunker();
      if (!bunker || !getAliveKaijus().length) {
        queueDeployFeedback(false);
        clearPendingDeploy();
        return;
      }
      if (!spendCommandCredits(option.cost)) {
        queueDeployFeedback(false);
        clearPendingDeploy();
        return;
      }

      let success = true;
      if (unitType === 'squad') {
        if (!target) success = false;
        else spawnSquadFromBunker(bunker, target);
      } else if (unitType === 'gunner_team') {
        if (!target) success = false;
        else spawnSpecialistTeamFromBunker(bunker, target, { count: 3, loadoutKey: 'gunner', spreadStep: 0.4 });
      } else if (unitType === 'sniper_team') {
        if (!target) success = false;
        else spawnSpecialistTeamFromBunker(bunker, target, { count: 2, loadoutKey: 'marksman', spreadStep: 0.5 });
      } else if (unitType === 'engineer_team') {
        if (!target) success = false;
        else spawnSpecialistTeamFromBunker(bunker, target, { count: 2, loadoutKey: 'engineer', spreadStep: 0.42 });
      } else if (unitType === 'barricade') {
        if (!target) success = false;
        else spawnBarricade(bunker, target);
      } else if (unitType === 'tank') {
        if (!target) success = false;
        else spawnTankFromBunker(bunker, target);
      } else if (unitType === 'apc') {
        if (!target) success = false;
        else spawnAPCFromBunker(bunker, target);
      } else if (unitType === 'jet') {
        success = launchJetSupport();
      } else {
        success = false;
      }

      if (!success) {
        economyRef.current.credits += option.cost;
        queueDeployFeedback(false);
        return;
      }

      queueDeployFeedback(true);
      clearPendingDeploy();
    };
    const handleBuildingPurchase = (event) => {
      const buildingKey = event?.detail?.buildingType;
      if (!buildingKey) return;
      const purchaseTarget = event?.detail?.target || window._falloutBuildPlacementTarget || window._falloutMouseTarget || window._falloutBuildFallbackTarget || null;
      const purchased = purchaseBuilding(buildingKey, purchaseTarget);
      if (!purchased) queueDeployFeedback(false);
      else clearPendingBuild();
    };
    const handleBuildingSelection = (event) => {
      const buildingKey = event?.detail?.buildingType;
      const option = BUILD_OPTIONS[buildingKey];
      if (!option) return;
      if (!canPurchaseBuilding(buildingKey) || !getBestDeployBunker()) {
        queueDeployFeedback(false);
        clearPendingBuild();
        return;
      }
      const nextPending = targetingRef.current.pendingBuild === buildingKey ? null : buildingKey;
      if (nextPending) setPendingBuild(nextPending);
      else clearPendingBuild();
    };
    const handleUpgradePurchase = (event) => {
      const upgradeKey = event?.detail?.upgradeType;
      if (!upgradeKey) return;
      const purchased = purchaseUpgrade(upgradeKey);
      if (!purchased) queueDeployFeedback(false);
    };
    const handleNukeArmSelection = () => {
      if (targetingRef.current.manualStrikeArmed) {
        clearPendingStrikeArm();
        return;
      }
      if (!canArmManualStrike()) {
        queueDeployFeedback(false);
        return;
      }
      setPendingStrikeArm();
      queueDeployFeedback(true);
    };

    window.addEventListener('fallout-select-deploy', handleDeploySelection);
    window.addEventListener('fallout-deploy-unit', handleDeployRequest);
    window.addEventListener('fallout-select-building', handleBuildingSelection);
    window.addEventListener('fallout-purchase-building', handleBuildingPurchase);
    window.addEventListener('fallout-purchase-upgrade', handleUpgradePurchase);
    window.addEventListener('fallout-arm-nuke', handleNukeArmSelection);
    return () => {
      window.removeEventListener('fallout-select-deploy', handleDeploySelection);
      window.removeEventListener('fallout-deploy-unit', handleDeployRequest);
      window.removeEventListener('fallout-select-building', handleBuildingSelection);
      window.removeEventListener('fallout-purchase-building', handleBuildingPurchase);
      window.removeEventListener('fallout-purchase-upgrade', handleUpgradePurchase);
      window.removeEventListener('fallout-arm-nuke', handleNukeArmSelection);
    };
  }, [themeConfig]);

  const startBombImpact = (bomb, impactX = bomb.x, impactZ = bomb.z) => {
    if (!bomb || bomb.detonated || bomb.impactPending) return;

    const settledX = impactX;
    const settledZ = impactZ;
    const settledY = getTerrainHeight(settledX, settledZ);

    bomb.impactPending = true;
    bomb.impactTimer = bomb.impactDelay || BOMB_IMPACT_DELAY;
    bomb.x = settledX;
    bomb.y = settledY + 1.2;
    bomb.z = settledZ;
    bomb.vx = 0;
    bomb.vy = 0;
    bomb.vz = 0;
    bomb.parachuteOpen = false;
    bomb.chuteInflation = 0;
    bomb.swayAmount = 0;
    bomb.impactX = settledX;
    bomb.impactZ = settledZ;
    bomb.impactY = settledY;

    entitiesRef.current.push({
      id: `impact-puff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'impact_puff',
      x: settledX,
      y: settledY,
      z: settledZ,
      dead: false
    });

    AudioManager.play('bomb');
  };

  const detonateBomb = (bomb, impactX = bomb.x, impactZ = bomb.z) => {
    if (!bomb || bomb.detonated) return;

    const blastX = impactX;
    const blastZ = impactZ;
    const blastY = getTerrainHeight(blastX, blastZ);
    const structureDamageRadius = bomb.isManual ? 360 : 320;
    const severeStructureRadius = bomb.isManual ? 200 : 170;
    const casualtyRadius = bomb.isManual ? 240 : 210;

    bomb.detonated = true;
    bomb.dead = true;
    bomb.x = blastX;
    bomb.y = blastY;
    bomb.z = blastZ;

    window.dispatchEvent(new CustomEvent('fallout-explosion', {
      detail: {
        x: blastX,
        z: blastZ,
        intensity: bomb.isManual ? 3.1 : 2.2,
        type: bomb.isManual ? 'nuke' : 'bomb'
      }
    }));

    AudioManager.play('nuke');

    spawnNukeAftermathFires(entitiesRef.current, blastX, blastZ, !!bomb.isManual);

    entitiesRef.current.push({
      id: `mushroom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'mushroom',
      x: blastX,
      y: blastY,
      z: blastZ,
      age: 0,
      scale: bomb.isManual ? NUKE_MUSHROOM_BASE_SCALE * 1.4 : NUKE_MUSHROOM_BASE_SCALE * 1.2,
      dead: false
    });
    pushImpactPuffEntity(entitiesRef.current, blastX, blastZ, blastY + 6);
    pushImpactPuffEntity(entitiesRef.current, blastX + 18, blastZ - 14, blastY + 4);
    pushImpactPuffEntity(entitiesRef.current, blastX - 16, blastZ + 10, blastY + 5);

    debugAirstrikeLog(`Bomb ${bomb.id}: detonated at (${blastX.toFixed(0)}, ${blastZ.toFixed(0)})`);
    setNukeCount(n => n + 1);
    if (bomb.isManual) {
      const cooldownMs = Math.round(
        MANUAL_STRIKE_COOLDOWN_MS * (economyRef.current.buildings?.radar_tower ? RADAR_NUKE_COOLDOWN_MULTIPLIER : 1)
      );
      targetingRef.current.cooldownUntil = Date.now() + cooldownMs;
      window._falloutStrikeCooldownRemaining = cooldownMs;
    }

    entitiesRef.current.forEach(other => {
      if (other.dead || other.type === 'scorch' || other.type === 'plane' || other.type === 'bomb' || other.type === 'mushroom') return;
      const dist = Math.sqrt(Math.pow(other.x - blastX, 2) + Math.pow(other.z - blastZ, 2));
      const dx = dist > 0 ? (other.x - blastX) / dist : 0;
      const dz = dist > 0 ? (other.z - blastZ) / dist : 0;

      if (dist < 400 && dist > 0) {
        const force = (400 - dist) / 400 * 50;

        if (other.vx !== undefined) {
          other.vx = (other.vx || 0) + dx * force;
          other.vz = (other.vz || 0) + dz * force;
        } else {
          other.vx = dx * force;
          other.vz = dz * force;
        }

        if (other.type === 'person' || other.type === 'bird') {
          other.vy = Math.min(other.vy || 0, force * 0.5);
        }
      }

      if (other.type === 'kaiju' || other.type === 'bunker' || other.type === 'facility') {
        const damageRadius = bomb.isManual ? 430 : 410;
        const damageMultiplier = other.type === 'facility'
          ? (bomb.isManual ? 2.4 : 1.9)
          : bomb.isManual ? 3.8 : 3.2;
        const damage = Math.max(0, damageRadius - dist) * damageMultiplier;
        other.hp -= damage;
        if ((other.type === 'bunker' || other.type === 'facility') && damage > 0) {
          other.lastDamagedAt = Date.now();
        }

        if (other.type === 'kaiju' && dist < 300 && dist > 0) {
          other.staggered = true;
          other.staggerTimer = 60 + Math.random() * 60;
          const pushBack = Math.max(0, 300 - dist) / 300 * 30;
          other.x += ((other.x - blastX) / dist) * pushBack;
          other.z += ((other.z - blastZ) / dist) * pushBack;
        }

        if (other.hp <= 0) {
          if (other.type === 'bunker' || other.type === 'facility') markStructureBroken(other);
          else if (other.type !== 'kaiju') other.dead = true;
          else markKaijuDefeated(other);
          if (other.type === 'bunker') AudioManager.play('bomb');
        }
      } else if (other.type === 'house') {
        if (dist < structureDamageRadius) {
          other.state = dist < severeStructureRadius ? 'ruined' : 'broken';
          other.damageSource = 'nuke';
        }
      } else if (other.type === 'tree') {
        if (dist < structureDamageRadius * 0.92) {
          other.state = 'broken';
          other.damageSource = 'nuke';
        }
      } else if (other.type === 'car' || other.type === 'tank') {
        if (dist < structureDamageRadius * 0.82) {
          if (other.type === 'tank') {
            const blastDamage = dist < severeStructureRadius ? 260 : 165;
            damageTank(other, blastDamage, { breakOnHit: dist < severeStructureRadius * 0.82 });
          } else {
            other.state = 'broken';
          }
          other.damageSource = 'nuke';
          other.vx = (other.vx || 0) + dx * 14;
          other.vz = (other.vz || 0) + dz * 14;
        }
      } else if (dist < casualtyRadius) {
        other.dead = true;
      }
    });
  };

  const gcCounter = useRef(0);
  const cutsceneTimer = useRef(5);
  const frameCount = useRef(0);
  const lastEntityCountRef = useRef(0);

  useFrame((state, delta) => {
    if (!themeConfig || !mounted) return;

    const frameSnapshot = rebuildFrameSnapshot();
    
    // === GLOBAL STRIKE PROGRESSION STATUS ===
    // Check if the current manual strike has cleared
    const activeManualStrike = hasActiveManualStrike();
    const cooldownRemaining = getManualStrikeCooldownRemaining();
    if (targetingRef.current.isStrikeInProgress) {
       if (!activeManualStrike) {
          targetingRef.current.isStrikeInProgress = false;
       }
    }
    if (!activeManualStrike && cooldownRemaining <= 0 && targetingRef.current.confirmedTarget) {
      clearConfirmedTarget();
    }
    let activeBombCamBomb = null;
    if (bombCamRef.current.active && bombCamRef.current.bombId) {
      activeBombCamBomb = entityLookupRef.current.get(bombCamRef.current.bombId);
      if (!activeBombCamBomb || activeBombCamBomb.dead || activeBombCamBomb.detonated) {
        clearBombCam();
        activeBombCamBomb = null;
      } else {
        window._falloutBombCamActive = true;
        window._falloutBombCamBombId = activeBombCamBomb.id;
      }
    } else {
      window._falloutBombCamActive = false;
      window._falloutBombCamBombId = null;
    }
    const bestDeployBunker = getBestDeployBunker();
    if (targetingRef.current.pendingBuild && !window._falloutMouseTarget && bestDeployBunker) {
      window._falloutMouseTarget = clampStrikeTarget({
        x: bestDeployBunker.x + 150,
        z: bestDeployBunker.z + 120
      });
    }
    const hasPointerTarget = !!window._falloutMouseTarget;
    const isDeployMode = !!targetingRef.current.pendingDeploy;
    const isBuildMode = !!targetingRef.current.pendingBuild;
    const isStrikeMode = !!targetingRef.current.manualStrikeArmed;
    const placementTarget = window._falloutMouseTarget || window._falloutBuildFallbackTarget || null;
    const buildPlacement = isBuildMode && placementTarget
      ? validateBuildingPlacement(placementTarget, { snap: true })
      : { ok: false };
    const deployUnlocks = getDeployUnlocks();
    window._falloutTargetProgress = !isDeployMode && !isBuildMode && isStrikeMode && hasPointerTarget ? 1 : 0;
    window._falloutManualStrikeInFlight = targetingRef.current.isStrikeInProgress || activeManualStrike;
    window._falloutManualStrikeArmed = isStrikeMode;
    window._falloutPendingDeploy = targetingRef.current.pendingDeploy;
    window._falloutPendingBuild = targetingRef.current.pendingBuild;
    window._falloutDeployDragActive = !!deployDragRef.current.active;
    window._falloutDeployDragTarget = deployDragRef.current.target || null;
    window._falloutBuildDragActive = !!buildDragRef.current.active;
    window._falloutBuildDragTarget = buildDragRef.current.target || null;
    window._falloutBuildPlacementValid = !!buildPlacement.ok;
    window._falloutDeployUnlocks = deployUnlocks;
    window._falloutBuildOptions = BUILD_OPTIONS;
    window._falloutUpgradeOptions = UPGRADE_OPTIONS;
    window._falloutBuildState = { ...economyRef.current.buildings };
    window._falloutBuildQueue = { ...economyRef.current.buildQueue };
    window._falloutUpgradeState = { ...economyRef.current.upgrades };
    window._falloutDeployAnchor = bestDeployBunker
      ? { x: bestDeployBunker.x, z: bestDeployBunker.z }
      : null;
    window._falloutBuildPlacementTarget = isBuildMode ? (buildPlacement.target || placementTarget) : null;
    window._falloutBuildFallbackTarget = isBuildMode ? (buildPlacement.target || placementTarget) : null;
    window._falloutStrikeReady = isStrikeMode && hasPointerTarget && !targetingRef.current.isStrikeInProgress && cooldownRemaining <= 0 && !isDeployMode && !isBuildMode && !deployDragRef.current.active && !buildDragRef.current.active;
    window._falloutStrikeCooldownRemaining = cooldownRemaining;
    
    frameCount.current++;
    
    // === AUTONOMOUS CINEMATIC AIRSTRIKES ===
    // Drops bombs organically so no clicking is required!
    if (AUTO_AIRSTRIKES_ENABLED && frameCount.current % 240 === 0) {
      const kaijus = frameSnapshot.aliveKaijus;
      if (kaijus.length > 0 && Math.random() < 0.6) {
          const target = kaijus[Math.floor(Math.random() * kaijus.length)];
          const dropX = target.x + (Math.random() - 0.5) * 150;
          const dropZ = target.z + (Math.random() - 0.5) * 150;
          entitiesRef.current.push(createPlaneStrikeEntity({
             idPrefix: 'plane-auto',
             dropX,
             dropZ
          }));
          AudioManager.play('plane_engine', { volume: 0.2, duration: 0.8 });
      }
    }
    
    // Normalizing speed for high-refresh rate monitors (60fps reference)
    const ds = delta * 60;

    // === MANUAL BOMB-CAM ===
    if (activeBombCamBomb) {
      window._cutsceneInProgress = false;
      const bombTargetX = activeBombCamBomb.targetX ?? activeBombCamBomb.x;
      const bombTargetZ = activeBombCamBomb.targetZ ?? activeBombCamBomb.z;
      const targetTerrain = getTerrainHeight(bombTargetX, bombTargetZ);
      const toTarget = new THREE.Vector3(
        bombTargetX - activeBombCamBomb.x,
        targetTerrain - activeBombCamBomb.y,
        bombTargetZ - activeBombCamBomb.z
      );
      if (toTarget.lengthSq() < 0.001) {
        toTarget.set(activeBombCamBomb.vx || 0.001, -1, activeBombCamBomb.vz || 0.001);
      }
      toTarget.normalize();

      const desiredCamPos = new THREE.Vector3(
        activeBombCamBomb.x + toTarget.x * BOMB_CAM_CAMERA_FORWARD_OFFSET,
        activeBombCamBomb.y + BOMB_CAM_CAMERA_HEIGHT,
        activeBombCamBomb.z + toTarget.z * BOMB_CAM_CAMERA_FORWARD_OFFSET
      );
      const desiredLookAt = new THREE.Vector3(
        activeBombCamBomb.x + toTarget.x * BOMB_CAM_LOOK_AHEAD,
        Math.max(targetTerrain + 10, activeBombCamBomb.y + toTarget.y * (BOMB_CAM_LOOK_AHEAD * 0.45)),
        activeBombCamBomb.z + toTarget.z * BOMB_CAM_LOOK_AHEAD
      );

      bombCamRef.current.smoothedPosition.lerp(desiredCamPos, Math.min(1, BOMB_CAM_CAMERA_LERP * ds));
      bombCamRef.current.smoothedLookAt.lerp(desiredLookAt, Math.min(1, BOMB_CAM_LOOK_LERP * ds));
      camera.position.copy(bombCamRef.current.smoothedPosition);
      camera.lookAt(bombCamRef.current.smoothedLookAt);
      originalCamPos.current.copy(camera.position);
    }
    // === CINEMATIC CUTSCENE INTRO ===
    else if (cutsceneTimer.current > 0) {
      window._cutsceneInProgress = true;
      cutsceneTimer.current -= delta;
      
      const kaiju = entitiesRef.current.find(e => e.type === 'kaiju' && !isKaijuDefeated(e));
      if (kaiju) {
         const progress = 1 - Math.max(0, cutsceneTimer.current / 5);
         // Ease out cubic
         const ease = 1 - Math.pow(1 - progress, 3);
         
         // Start from a dramatic high-angle focusing on the Kaiju
         const startY = 1000, startZ = 1200;
         const endY = originalCamPos.current.y, endZ = originalCamPos.current.z;
         
         const curX = kaiju.x * (1 - ease) + originalCamPos.current.x * ease;
         const curY = startY + (endY - startY) * ease;
         const curZ = kaiju.z * (1 - ease) + startZ * (1 - ease) + endZ * ease;
         
         camera.position.set(curX, curY, curZ);
         camera.lookAt(kaiju.x * (1 - ease) * 0.5, 0, kaiju.z * (1 - ease) * 0.5);
      }
     } else if (cutsceneTimer.current > -1) {
        window._cutsceneInProgress = false;
        
        // Smooth zoom lerp
        zoomLevel.current += (targetZoom.current - zoomLevel.current) * 0.1;
        
        // WASD Free-form camera movement (Relative to current rotation)
        const moveSpeed = 15 / zoomLevel.current; 
        const yaw = cameraRotation.current.yaw;
        const forwardX = -Math.sin(yaw);
        const forwardZ = -Math.cos(yaw);
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);

        if (keys.current['KeyW'] || keys.current['ArrowUp']) {
           moveOffset.current.x += forwardX * moveSpeed;
           moveOffset.current.z += forwardZ * moveSpeed;
        }
        if (keys.current['KeyS'] || keys.current['ArrowDown']) {
           moveOffset.current.x -= forwardX * moveSpeed;
           moveOffset.current.z -= forwardZ * moveSpeed;
        }
        if (keys.current['KeyA'] || keys.current['ArrowLeft']) {
           moveOffset.current.x -= rightX * moveSpeed;
           moveOffset.current.z -= rightZ * moveSpeed;
        }
        if (keys.current['KeyD'] || keys.current['ArrowRight']) {
           moveOffset.current.x += rightX * moveSpeed;
           moveOffset.current.z += rightZ * moveSpeed;
        }

        // Orbital camera position using spherical coordinates
        const pitch = cameraRotation.current.pitch;
        const radius = 1200 / zoomLevel.current;
        
        camera.position.x = moveOffset.current.x + Math.sin(yaw) * Math.cos(pitch) * radius;
        camera.position.y = Math.sin(pitch) * radius;
        camera.position.z = moveOffset.current.z + Math.cos(yaw) * Math.cos(pitch) * radius;
        
        camera.lookAt(moveOffset.current.x, 0, moveOffset.current.z);
        
        // Keep originalCamPos synced for shockwave shakes
        originalCamPos.current.copy(camera.position);
     }

    // === GARBAGE COLLECTION: Remove dead ephemeral entities every 120 frames ===
    gcCounter.current++;
    if (gcCounter.current >= 120) {
      gcCounter.current = 0;
      const ephemeralTypes = new Set(['bullet', 'shell', 'muzzle_flash', 'missile', 'missile_impact', 'impact_puff', 'corpse', 'mushroom', 'kaiju_attack', 'firebreath']);
      const before = entitiesRef.current.length;
      entitiesRef.current = entitiesRef.current.filter(e => {
        if (e.dead && (ephemeralTypes.has(e.type) || (e.type === 'scorch' && e.temporary))) return false;
        return true;
      });
      // Preserve flags
      if (entitiesRef.current._victoryTriggered === undefined) entitiesRef.current._victoryTriggered = false;
      if (entitiesRef.current._defeatTriggered === undefined) entitiesRef.current._defeatTriggered = false;
    }

    if (setGameState) {
       if (waveRef.current.transitioning && state.clock.elapsedTime >= waveRef.current.nextWaveAt) {
         pruneDefeatedKaijus();
         spawnKaijuWave(waveRef.current.nextLevel);
         currentSectorNameRef.current = nextSectorNameRef.current || currentSectorNameRef.current;
         nextSectorNameRef.current = pickRandomSectorName(
           THEMES.find((theme) => formatSectorName(theme?.name) === currentSectorNameRef.current)?.name || ''
         );
         waveRef.current.transitioning = false;
         waveRef.current.clearHandled = false;
         AudioManager.play('kaiju_roar', { volume: 0.16, duration: 0.45 });
       }

       const kaijus = frameSnapshot.allKaijus;
       const bunkers = frameSnapshot.allBunkers;
       const aliveKaijus = frameSnapshot.aliveKaijus;
      const incomePerSecond =
        COMMAND_INCOME_PER_SECOND +
        bunkers.filter(b => !b.dead && !isBrokenStructure(b)).length * COMMAND_BUNKER_BONUS_PER_SECOND +
        (economyRef.current.incomeBonus || 0);
       if (!economyRef.current.lastIncomeAt) {
         economyRef.current.lastIncomeAt = state.clock.elapsedTime;
       }
       const incomeDelta = state.clock.elapsedTime - economyRef.current.lastIncomeAt;
       if (incomeDelta >= 1) {
         const incomeTicks = Math.floor(incomeDelta);
         economyRef.current.credits = Math.min(
           COMMAND_CREDIT_CAP,
           economyRef.current.credits + incomeTicks * incomePerSecond
         );
         economyRef.current.lastIncomeAt += incomeTicks;
       }
       
       if (kaijus.length > 0) {
           kaijus.forEach((kaiju) => {
             if (isKaijuDefeated(kaiju) && !kaiju.rewardGranted) {
               addCredits(kaiju.isMini ? MINI_MONSTER_KILL_REWARD : KAIJU_KILL_REWARD);
               kaiju.rewardGranted = true;
             }
           });
           const allDead = aliveKaijus.length === 0;
           if (!allDead) {
             waveRef.current.clearHandled = false;
           }
           if (allDead && !entitiesRef.current._victoryTriggered && !waveRef.current.transitioning && !waveRef.current.clearHandled) {
               waveRef.current.clearHandled = true;
               if (waveRef.current.level >= waveRef.current.totalLevels) {
                 pruneDefeatedKaijus();
                 entitiesRef.current._victoryTriggered = true;
                 setGameState('won');
               } else {
                 rewardForWaveClear(waveRef.current.level);
                 waveRef.current.transitioning = true;
                 waveRef.current.nextLevel = waveRef.current.level + 1;
                 waveRef.current.nextWaveAt = state.clock.elapsedTime + LEVEL_INTERMISSION_SECONDS;
                 nextSectorNameRef.current = pickRandomSectorName(
                   THEMES.find((theme) => formatSectorName(theme?.name) === currentSectorNameRef.current)?.name || ''
                 );
                 AudioManager.play('target_confirm', { volume: 0.1, duration: 0.18 });
               }
           }
           
           const allBunkersDead = bunkers.length > 0 && bunkers.every(b => b.dead || isBrokenStructure(b));
           if (allBunkersDead && !entitiesRef.current._defeatTriggered) {
               const hasActiveDrops = entitiesRef.current.some(e => 
                  (e.type === 'bomb' && !e.dead) || 
                  (e.type === 'plane' && !e.dead && !e.dropped)
               );
               if (!hasActiveDrops) {
                  entitiesRef.current._defeatTriggered = true;
                  setGameState('lost');
               }
           }
       }
       
       // Publish stats for HUD (every ~30 frames to avoid overhead)
       if (gcCounter.current % 30 === 0) {
        window._falloutGameStats = {
          bunkers: bunkers.map(b => ({ hp: b.hp, maxHp: b.maxHp, dead: b.dead || isBrokenStructure(b) })),
          tanks: frameSnapshot.liveTanks.filter(e => e.state !== 'broken').length,
          soldiers: frameSnapshot.liveSoldiers.length,
          jets: frameSnapshot.liveJets.length,
          credits: Math.floor(economyRef.current.credits),
          incomePerSecond,
          nukeCost: MANUAL_STRIKE_COST,
          nukeArmed: isStrikeMode,
          nukeCanArm: canArmManualStrike(),
          deployCosts: DEPLOY_OPTIONS,
          deployUnlocks: getDeployUnlocks(),
          buildOptions: BUILD_OPTIONS,
          buildState: { ...economyRef.current.buildings },
          buildQueue: { ...economyRef.current.buildQueue },
          construction: entitiesRef.current
            .filter(e => e.type === 'facility' && !e.dead && !isBrokenStructure(e) && e.constructing)
            .map(e => ({
              kind: e.kind,
              label: BUILD_OPTIONS[e.kind]?.label || e.kind,
              progress: THREE.MathUtils.clamp(e.buildProgress ?? 0, 0, 1)
            })),
          upgradeOptions: UPGRADE_OPTIONS,
          upgradeState: { ...economyRef.current.upgrades },
          wave: {
             level: waveRef.current.level,
             upcomingLevel: waveRef.current.transitioning ? waveRef.current.nextLevel : waveRef.current.level,
             sectorName: currentSectorNameRef.current,
             nextSectorName: waveRef.current.transitioning ? nextSectorNameRef.current : currentSectorNameRef.current,
             totalLevels: waveRef.current.totalLevels,
             intermission: waveRef.current.transitioning,
             nextWaveSeconds: waveRef.current.transitioning
               ? Math.max(0, Math.ceil(waveRef.current.nextWaveAt - state.clock.elapsedTime))
               : 0,
             remainingKaijus: aliveKaijus.length
           },
           kaijus: kaijus.map(k => ({
             hp: Math.max(0, k.hp),
             maxHp: k.maxHp,
             dead: isKaijuDefeated(k),
             state: isKaijuDefeated(k) ? (k.dead || k.state === 'dead' ? 'dead' : 'dying') : (k.state || 'alive'),
             variant: k.variant,
             level: k.level
           }))
         };
       }
    }

     entitiesRef.current.forEach(p => {
      if (p.dead || p.type === 'tree' || p.type === 'house' || p.type === 'scorch') return;
      
      if (p.type === 'plane') {
         // Clamp ds to prevent huge jumps on laggy frames
         const clampedDs = Math.min(ds, 2.0); // Max 2x normal frame speed
         p.x += p.vx * clampedDs;
         p.z += p.vz * clampedDs;
         
         // Play engine sound periodically
         p.engineSoundTimer = (p.engineSoundTimer || 0) + 1;
         if (p.engineSoundTimer > 60) { // Every ~1 second at 60fps
            AudioManager.play('plane_engine', { volume: 0.11, duration: 0.72 });
            p.engineSoundTimer = 0;
         }
         
         // Calculate distance to drop target
         const dx = p.dropX - p.x;
         const dz = p.dropZ - p.z;
         const distToTarget = Math.sqrt(dx * dx + dz * dz);
         const bombSpawn = getPlaneBombSpawnPosition(p);
         const targetY = getTerrainHeight(p.dropX, p.dropZ);
         const fallFrames = Math.max(12, (bombSpawn.y - targetY) / Math.max(1, BOMB_PARACHUTE_FALL_SPEED));
         const carriedDistance = Math.max(
           Math.sqrt((p.vx || 0) ** 2 + (p.vz || 0) ** 2),
           BOMB_PARACHUTE_GLIDE_SPEED * 0.8
         ) * fallFrames;
         const releaseDistance = Math.max(250, Math.min(520, carriedDistance * 0.82));
         const velocityLength = Math.sqrt((p.vx || 0) ** 2 + (p.vz || 0) ** 2) || 1;
         const approachDot = ((dx * (p.vx || 0)) + (dz * (p.vz || 0))) / (distToTarget * velocityLength || 1);
         const isApproachingTarget = approachDot > 0.45;
         const hasCommittedToRun = distToTarget < 1100 || p.minDistToTarget < 1100;
         if (!p.attackRunArmed && isApproachingTarget && hasCommittedToRun) {
            p.attackRunArmed = true;
         }
         
         // Track minimum distance reached (for passed-target detection)
         p.minDistToTarget = Math.min(p.minDistToTarget || Infinity, distToTarget);
         const prevDist = p.prevDist || Infinity;
         const dropPlaneBomb = (reason) => {
            if (p.dropped) return;
            debugAirstrikeLog(
              `Plane ${p.id}: ${reason} (dist=${distToTarget.toFixed(1)}, release=${releaseDistance.toFixed(1)}, min=${p.minDistToTarget.toFixed(1)})`
            );
            p.dropped = true;
            const droppedBomb = createBombFromPlane(p);
            entitiesRef.current.push(droppedBomb);
            if (droppedBomb.isManual) activateBombCam(droppedBomb);
            AudioManager.play('bomb_whistle', { duration: 1.65, volume: 0.085 });
         };

         if (!p.flybySoundPlayed && distToTarget < 960) {
            p.flybySoundPlayed = true;
            AudioManager.play('plane_flyby', { volume: 0.12, duration: 1.8 });
         }
         
         // DEBUG: Log plane state
         if (frameCount.current % 60 === 0) {
            debugAirstrikeLog(`Plane ${p.id}: dist=${distToTarget.toFixed(1)}, dropped=${p.dropped}, pos=(${p.x.toFixed(0)},${p.z.toFixed(0)}), target=(${p.dropX.toFixed(0)},${p.dropZ.toFixed(0)})`);
         }
         
         // Release based on the bomb's actual fall time so it lands on the target.
         if (!p.dropped && p.attackRunArmed && isApproachingTarget && distToTarget <= releaseDistance) {
            dropPlaneBomb('TIMED DROP triggered');
         }
         // Fallback: passed target
         else if (!p.dropped && p.attackRunArmed && distToTarget > prevDist && p.minDistToTarget < releaseDistance + 25) {
            dropPlaneBomb('PASSED TARGET DROP');
         }
         
         // Safety: Force drop if plane is about to despawn without dropping
         if (!p.dropped && p.attackRunArmed && shouldForcePlaneDrop(p)) {
            dropPlaneBomb('SAFETY DROP triggered');
         }
         
         // EXTRA SAFETY: Drop if we're far from target but somehow missed all other conditions
         if (!p.dropped && p.attackRunArmed && distToTarget > 1000 && p.minDistToTarget < releaseDistance + 40) {
            dropPlaneBomb('EXTRA SAFETY DROP - far from target after being close');
         }
         
         // Despawn when far away from the center
         if (Math.abs(p.x) > 5000 || Math.abs(p.z) > 5000) {
            debugAirstrikeLog(`Plane ${p.id}: DESPAWNING at pos=(${p.x.toFixed(0)},${p.z.toFixed(0)})`);
            p.dead = true;
         }
         
         p.prevDist = distToTarget;
      }
      else if (p.type === 'bomb') {
         const bombDs = Math.min(ds, 2.0);
         p.age = (p.age || 0) + delta;

         if (p.impactPending) {
            p.impactTimer = Math.max(0, (p.impactTimer || 0) - delta);
            p.x = p.impactX ?? p.x;
            p.y = (p.impactY ?? getTerrainHeight(p.x, p.z)) + 1.2;
            p.z = p.impactZ ?? p.z;
            p.vx = 0;
            p.vy = 0;
            p.vz = 0;

            if (p.impactTimer <= 0) {
               detonateBomb(p, p.impactX ?? p.x, p.impactZ ?? p.z);
            }
            return;
         }

         if (!p.parachuteOpen && p.age >= (p.deployDelay || BOMB_PARACHUTE_DEPLOY_DELAY)) {
            p.parachuteOpen = true;
            if (!p.whistlePlayed) {
              p.whistlePlayed = true;
              AudioManager.play('bomb_whistle');
            }
         }

         const dx = (p.targetX ?? p.x) - p.x;
         const dz = (p.targetZ ?? p.z) - p.z;
         const distXZ = Math.sqrt(dx * dx + dz * dz);
         const targetY = getTerrainHeight(p.targetX ?? p.x, p.targetZ ?? p.z);
         const terrainY = getTerrainHeight(p.x, p.z);
         const swayPhase = (p.age || 0) * BOMB_PARACHUTE_SWAY_SPEED + (p.swaySeed || 0);
         const isControlledBomb = p.isManual && bombCamRef.current.active && bombCamRef.current.bombId === p.id;

         if (p.parachuteOpen) {
            if (isControlledBomb) {
              const forwardInput = (keys.current['KeyW'] || keys.current['ArrowUp'] ? 1 : 0) - (keys.current['KeyS'] || keys.current['ArrowDown'] ? 1 : 0);
              const strafeInput = (keys.current['KeyD'] || keys.current['ArrowRight'] ? 1 : 0) - (keys.current['KeyA'] || keys.current['ArrowLeft'] ? 1 : 0);
              if (forwardInput !== 0 || strafeInput !== 0) {
                const baseDirX = distXZ > 0.001 ? (dx / distXZ) : Math.sign(p.vx || 1);
                const baseDirZ = distXZ > 0.001 ? (dz / distXZ) : Math.sign(p.vz || -1);
                const lateralX = -baseDirZ;
                const lateralZ = baseDirX;
                const steerVectorX = baseDirX * forwardInput + lateralX * strafeInput;
                const steerVectorZ = baseDirZ * forwardInput + lateralZ * strafeInput;
                const steerLength = Math.sqrt(steerVectorX * steerVectorX + steerVectorZ * steerVectorZ) || 1;
                const nextTarget = clampStrikeTarget({
                  x: (p.targetX ?? p.x) + (steerVectorX / steerLength) * (p.controlStrength || BOMB_CAM_STEER_SPEED) * delta,
                  z: (p.targetZ ?? p.z) + (steerVectorZ / steerLength) * (p.controlStrength || BOMB_CAM_STEER_SPEED) * delta
                });
                p.targetX = nextTarget.x;
                p.targetZ = nextTarget.z;
                targetingRef.current.confirmedTarget = nextTarget;
                window._falloutConfirmedTarget = nextTarget;
              }
            }

            const glideSpeed = p.glideSpeed || BOMB_PARACHUTE_GLIDE_SPEED;
            const desiredSpeed = Math.min(glideSpeed, Math.max(1.2, distXZ * 0.06));
            const dirX = distXZ > 0.001 ? (dx / distXZ) : 0;
            const dirZ = distXZ > 0.001 ? (dz / distXZ) : 0;
            const lateralX = -dirZ;
            const lateralZ = dirX;
            const swayOffset = Math.sin(swayPhase) * Math.min(BOMB_PARACHUTE_SWAY_AMOUNT, Math.max(0.2, distXZ * 0.01));
            const desiredVx = dirX * desiredSpeed + lateralX * swayOffset;
            const desiredVz = dirZ * desiredSpeed + lateralZ * swayOffset;
            const steerLerp = Math.min(1, 0.12 * bombDs);

            p.vx = THREE.MathUtils.lerp(p.vx || 0, desiredVx, steerLerp);
            p.vz = THREE.MathUtils.lerp(p.vz || 0, desiredVz, steerLerp);
            p.vy = THREE.MathUtils.lerp(
              p.vy || 0,
              -(p.fallSpeed || BOMB_PARACHUTE_FALL_SPEED) - Math.abs(Math.cos(swayPhase)) * 0.25,
              Math.min(1, 0.16 * bombDs)
            );
            p.chuteInflation = THREE.MathUtils.lerp(p.chuteInflation ?? 0, 1, Math.min(1, delta * 4.5));
            p.swayAmount = THREE.MathUtils.lerp(p.swayAmount ?? 0, 1, Math.min(1, delta * 2.8));
         } else {
            p.vy -= (p.grav || BOMB_DROP_GRAVITY) * bombDs;
            p.chuteInflation = THREE.MathUtils.lerp(p.chuteInflation ?? 0, 0, Math.min(1, delta * 6));
            p.swayAmount = THREE.MathUtils.lerp(p.swayAmount ?? 0, 0.2, Math.min(1, delta * 4));
         }

         p.x += (p.vx || 0) * bombDs;
         p.y += (p.vy || 0) * bombDs;
         p.z += (p.vz || 0) * bombDs;

         if (p.parachuteOpen && distXZ < (p.targetProximity || BOMB_TARGET_PROXIMITY)) {
            p.x = p.targetX;
            p.z = p.targetZ;
         }
         
         // DEBUG: Log bomb state
         if (frameCount.current % 10 === 0) {
            debugAirstrikeLog(`Bomb ${p.id}: pos=(${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}), target=(${(p.targetX ?? p.x).toFixed(0)},${(p.targetZ ?? p.z).toFixed(0)}), chute=${p.parachuteOpen}`);
         }

         const nearTarget = distXZ <= (p.targetProximity || BOMB_TARGET_PROXIMITY);
         const reachedTargetAltitude = p.y <= targetY + 4;
         const hitTerrain = p.y <= terrainY + 2;
         const forceDetonate = p.age > 25 || p.y < -200;

         if (!p.detonated && ((nearTarget && reachedTargetAltitude) || hitTerrain)) {
            startBombImpact(p, p.targetX ?? p.x, p.targetZ ?? p.z);
         } else if (!p.detonated && forceDetonate) {
            startBombImpact(p, p.targetX ?? p.x, p.targetZ ?? p.z);
         }
      }
      else if (p.type === 'facility') {
        p.y = getTerrainHeight(p.x, p.z);
        if (p.hp <= 0) {
          if (p.constructing && economyRef.current.buildQueue?.[p.kind]) {
            economyRef.current.buildQueue[p.kind] = false;
          }
          markStructureBroken(p);
          return;
        }
        if (p.constructing) {
          let nearbyEngineers = 0;
          frameSnapshot.liveEngineers.forEach((ally) => {
            if (!ally || ally.dead || ally.type !== 'soldier' || ally.weaponType !== 'engineer') return;
            const dist = Math.hypot((ally.x || 0) - p.x, (ally.z || 0) - p.z);
            if (dist < ENGINEER_REPAIR_RANGE * 0.85) nearbyEngineers++;
          });
          const buildBoost = 1 + nearbyEngineers * ENGINEER_BUILD_BOOST_PER_ENGINEER;
          p.buildElapsed = (p.buildElapsed || 0) + delta * buildBoost;
          p.buildProgress = THREE.MathUtils.clamp((p.buildElapsed || 0) / (p.buildDuration || FACILITY_BUILD_DURATION), 0, 1);
          if (p.buildProgress >= 1) {
            p.constructing = false;
            p.buildProgress = 1;
            p.buildElapsed = p.buildDuration || FACILITY_BUILD_DURATION;
            if (!economyRef.current.buildings[p.kind]) {
              economyRef.current.buildings[p.kind] = true;
              if (p.kind === 'powerplant') {
                economyRef.current.incomeBonus += POWERPLANT_INCOME_BONUS;
              } else if (p.kind === 'radar_tower') {
                economyRef.current.incomeBonus += RADAR_TOWER_INCOME_BONUS;
              }
            }
            economyRef.current.buildQueue[p.kind] = false;
            AudioManager.play('target_confirm', { volume: 0.1, duration: 0.16 });
          } else {
            return;
          }
        }
        if (p.kind === 'field_hospital') {
          const healDelta = delta;
          frameSnapshot.aliveBunkers.forEach((ally) => {
            const dist = Math.hypot((ally.x || 0) - p.x, (ally.z || 0) - p.z);
            if (dist < HOSPITAL_HEAL_RANGE * 1.18) {
              ally.hp = Math.min(ally.maxHp || BUNKER_BASE_HP, (ally.hp || 0) + HOSPITAL_BUNKER_HEAL_PER_SECOND * healDelta);
            }
          });
          frameSnapshot.liveSoldiers.forEach((ally) => {
            if (!ally || ally.dead) return;
            const dist = Math.hypot((ally.x || 0) - p.x, (ally.z || 0) - p.z);
            if (dist < HOSPITAL_HEAL_RANGE) {
              ally.hp = Math.min(ally.maxHp || 60, (ally.hp || 0) + HOSPITAL_UNIT_HEAL_PER_SECOND * healDelta);
            }
          });
          frameSnapshot.liveTanks.forEach((ally) => {
            if (!ally || ally.dead) return;
            const dist = Math.hypot((ally.x || 0) - p.x, (ally.z || 0) - p.z);
            if (dist < HOSPITAL_HEAL_RANGE) {
              ally.hp = Math.min(ally.maxHp || TANK_BASE_HP, (ally.hp || 0) + HOSPITAL_UNIT_HEAL_PER_SECOND * 2.2 * healDelta);
              if (ally.state === 'broken' && (ally.hp || 0) > (ally.maxHp || TANK_BASE_HP) * 0.34) {
                ally.state = 'driving';
              }
            }
          });
        }
        if (p.kind === 'aa_site') {
          p.reloadTimer = Math.max(0, (p.reloadTimer || 0) - delta);
          let targetFlyingKaiju = null;
          let targetDist = AA_SITE_RANGE;
          frameSnapshot.flyingKaijus.forEach((candidate) => {
            if (candidate.type !== 'kaiju' || isKaijuDefeated(candidate) || !isFlyingKaiju(candidate)) return;
            const dx = candidate.x - p.x;
            const dy = (candidate.y || 0) - (p.y + 18);
            const dz = candidate.z - p.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < targetDist) {
              targetDist = dist;
              targetFlyingKaiju = candidate;
            }
          });
          if (targetFlyingKaiju) {
            p.turretYaw = Math.atan2(targetFlyingKaiju.x - p.x, targetFlyingKaiju.z - p.z);
            if (p.reloadTimer <= 0) {
              p.reloadTimer = AA_SITE_RELOAD_TIME + Math.random() * 0.18;
              targetFlyingKaiju.hp -= AA_SITE_DAMAGE * (targetFlyingKaiju.isMini ? 1.2 : 1);
              if (targetFlyingKaiju.hp <= 0) markKaijuDefeated(targetFlyingKaiju);
              entitiesRef.current.push({
                id: `aa-tracer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                type: 'bullet',
                x: p.x,
                y: p.y + 20,
                z: p.z,
                targetX: targetFlyingKaiju.x,
                targetY: (targetFlyingKaiju.y || 0) + 10,
                targetZ: targetFlyingKaiju.z,
                age: 0,
                dead: false
              });
              AudioManager.play('gun', { profile: 'gunner', volume: 0.12 });
            }
          }
        }
      }
      else if (p.type === 'barricade') {
        if (Date.now() >= (p.expiresAt || 0) || p.hp <= 0) {
          p.dead = true;
        }
      }
      else if (p.type === 'car') {
        p.x += p.vx * ds;
        if (p.vy !== undefined) {
           p.y = (p.y || 0) + p.vy * ds;
           p.vy -= 1.5 * ds; // Gravity
           if (p.y < 0) {
             p.y = 0; p.vy = -p.vy * 0.4; // Bounce
             if (Math.abs(p.vy) < 2) p.vy = undefined;
           }
        }
        if (p.state === 'fleeing') {
          if (p.x < -WORLD_WIDTH/2 || p.x > WORLD_WIDTH/2) p.dead = true;
        } else {
          if (p.x < -WORLD_WIDTH/2 - 100) p.x = WORLD_WIDTH/2 + 100;
          if (p.x > WORLD_WIDTH/2 + 100) p.x = -WORLD_WIDTH/2 - 100;
        }
      } 
      else if (p.type === 'bird') {
        p.x += p.vx * ds; p.y += p.vy * ds; p.z += p.vz * ds;
        if (p.state === 'fleeing') {
          if (p.y > 500 || p.x < -WORLD_WIDTH/2 || p.x > WORLD_WIDTH/2) p.dead = true;
        } else {
          if (Math.random() < 0.02) p.vy = (Math.random() - 0.5) * 2;
          else p.vy *= 0.95;
          if (p.x < -WORLD_WIDTH/2 - 50) p.x = WORLD_WIDTH/2 + 50;
          if (p.x > WORLD_WIDTH/2 + 50) p.x = -WORLD_WIDTH/2 - 50;
          if (p.z < -WORLD_DEPTH/2 - 50) p.z = WORLD_DEPTH/2 + 50;
          if (p.z > WORLD_DEPTH/2 + 50) p.z = -WORLD_DEPTH/2 - 50;
          if (p.y < 40) { p.y = 40; p.vy = Math.abs(p.vy); }
          if (p.y > 150) { p.y = 150; p.vy = -Math.abs(p.vy); }
        }
      } 
      else if (p.type === 'person') {
         const bunkers = frameSnapshot.aliveBunkers;
         if (bunkers.length > 0) {
             let nearestBunker = bunkers[0];
             let minDist = Infinity;
             bunkers.forEach(b => {
                 const entry = getVaultEntryPoint(b);
                 const kd = Math.sqrt(Math.pow(entry.x - p.x, 2) + Math.pow(entry.z - p.z, 2));
                 if (kd < minDist) { minDist = kd; nearestBunker = b; }
             });
             
             if (minDist < 20) {
                if (!p.rescued) {
                  addCredits(CIVILIAN_RESCUE_REWARD);
                  p.rescued = true;
                }
                 p.dead = true; // Hidden inside safely
             } else {
                 p.state = 'fleeing';
                 p.targetBunkerId = nearestBunker.id;
                 const entry = getVaultEntryPoint(nearestBunker);
                 const panicTime = state.clock.elapsedTime;
                 const dirX = entry.x - p.x;
                 const dirZ = entry.z - p.z;
                 const dirDist = Math.max(0.001, Math.sqrt(dirX * dirX + dirZ * dirZ));
                 const approachFactor = THREE.MathUtils.clamp(dirDist / 180, 0.35, 1);
                 const weave = Math.sin(panicTime * 6.5 + (p.panicSeed || 0)) * 0.28 * approachFactor;
                 const forwardX = dirX / dirDist;
                 const forwardZ = dirZ / dirDist;
                 const lateralX = -forwardZ * weave;
                 const lateralZ = forwardX * weave;

                 let repelX = 0;
                 let repelZ = 0;
                 frameSnapshot.livePersons.forEach(other => {
                    if (other === p || other.dead) return;
                    const ox = p.x - other.x;
                    const oz = p.z - other.z;
                    const od = Math.sqrt(ox * ox + oz * oz);
                    if (od > 0.001 && od < 22) {
                      const force = (22 - od) / 22;
                      repelX += (ox / od) * force;
                      repelZ += (oz / od) * force;
                    }
                 });

                 const nearestKaiju = frameSnapshot.aliveKaijus.reduce((closest, kaiju) => {
                   const dist = Math.hypot(kaiju.x - p.x, kaiju.z - p.z);
                   return !closest || dist < closest.dist ? { kaiju, dist } : closest;
                 }, null);
                 let dangerX = 0;
                 let dangerZ = 0;
                 if (nearestKaiju && nearestKaiju.dist < 340) {
                   const awayX = p.x - nearestKaiju.kaiju.x;
                   const awayZ = p.z - nearestKaiju.kaiju.z;
                   const awayDist = Math.max(0.001, nearestKaiju.dist);
                   const panicForce = (340 - awayDist) / 340;
                   dangerX = (awayX / awayDist) * panicForce * 1.8;
                   dangerZ = (awayZ / awayDist) * panicForce * 1.8;
                 }

                 const desiredX = forwardX + lateralX + repelX * 0.75 + dangerX;
                 const desiredZ = forwardZ + lateralZ + repelZ * 0.75 + dangerZ;
                 const desiredLen = Math.max(0.001, Math.sqrt(desiredX * desiredX + desiredZ * desiredZ));
                 const sprintSpeed = (3.4 + (p.panicUrgency || 1) * 1.1) * (p.panicBurst || 1) * THREE.MathUtils.clamp(dirDist / 120, 0.8, 1.25);
                 const desiredVx = (desiredX / desiredLen) * sprintSpeed * THREE.MathUtils.clamp(dirDist / 95, 0.55, 1);
                 const desiredVz = (desiredZ / desiredLen) * sprintSpeed * THREE.MathUtils.clamp(dirDist / 95, 0.55, 1);
                 const steer = Math.min(1, 0.12 * ds);
                 p.fleeVx = THREE.MathUtils.lerp(p.fleeVx || 0, desiredVx, steer);
                 p.fleeVz = THREE.MathUtils.lerp(p.fleeVz || 0, desiredVz, steer);
                 p.vx = p.fleeVx;
                 p.vz = p.fleeVz;
                 p.x += p.fleeVx * ds;
                 p.z += p.fleeVz * ds;
                 p.y = getTerrainHeight(p.x, p.z);
                 if (Math.random() < 0.0015) AudioManager.play('scream');
             }
         } else {
             p.state = 'fleeing';
             p.panicDecisionTimer = (p.panicDecisionTimer || 0) - delta;
             if (p.panicDecisionTimer <= 0) {
               const panicAngle = Math.random() * Math.PI * 2;
               const panicSpeed = 2.8 + Math.random() * 2.2;
               p.fleeVx = Math.cos(panicAngle) * panicSpeed;
               p.fleeVz = Math.sin(panicAngle) * panicSpeed;
               p.panicDecisionTimer = 0.6 + Math.random() * 0.9;
             }
             p.vx = p.fleeVx;
             p.vz = p.fleeVz;
             p.x += p.fleeVx * ds;
             p.z += p.fleeVz * ds;
             p.y = getTerrainHeight(p.x, p.z);
             if (Math.abs(p.x) > HALF_WORLD_WIDTH) p.fleeVx *= -0.8;
             if (Math.abs(p.z) > HALF_WORLD_DEPTH) p.fleeVz *= -0.8;
             if (Math.random() < 0.003) AudioManager.play('scream');
         }
      }
      else if (p.type === 'soldier') {
         if (p.commandTargetX !== undefined && p.commandTargetZ !== undefined) {
           const cdx = p.commandTargetX - p.x;
           const cdz = p.commandTargetZ - p.z;
           const commandDist = Math.sqrt(cdx * cdx + cdz * cdz);
           if (commandDist > 12) {
             const cAngle = Math.atan2(cdz, cdx);
             const commandSpeed = (p.combatSpeed || 2.6) * 1.1;
             p.state = 'walking';
             p.aimAngle = cAngle;
             p.vx = Math.cos(cAngle) * commandSpeed;
             p.vz = Math.sin(cAngle) * commandSpeed;
             p.x += p.vx * ds;
             p.z += p.vz * ds;
             p.y = getTerrainHeight(p.x, p.z);
             p.hurtTimer = Math.max(0, (p.hurtTimer || 0) - delta);
             return;
           }
           p.commandTargetX = undefined;
           p.commandTargetZ = undefined;
         }

         if (p.weaponType === 'engineer') {
           let repairTarget = null;
           let repairDist = Infinity;
           frameSnapshot.repairTargets.forEach((entity) => {
             if (!entity) return;
             const repairable =
               (entity.type === 'bunker' && (entity.hp || 0) < (entity.maxHp || BUNKER_BASE_HP)) ||
               (entity.type === 'facility' && (entity.hp || 0) < (entity.maxHp || 1000)) ||
               (entity.type === 'barricade' && !entity.dead && (entity.hp || 0) < (entity.maxHp || BARRICADE_MAX_HP)) ||
               (entity.type === 'tank' && (entity.hp || 0) < (entity.maxHp || TANK_BASE_HP));
             if (!repairable) return;
             const dist = Math.hypot((entity.x || 0) - p.x, (entity.z || 0) - p.z);
             if (dist < repairDist) {
               repairDist = dist;
               repairTarget = entity;
             }
           });

           if (repairTarget) {
             const dx = repairTarget.x - p.x;
             const dz = repairTarget.z - p.z;
             const dist = Math.max(0.001, Math.hypot(dx, dz));
             p.aimAngle = Math.atan2(dz, dx);
             if (repairDist > ENGINEER_REPAIR_RANGE * 0.58) {
               const moveSpeed = (p.combatSpeed || 2.6) * 0.82;
               p.state = 'walking';
               p.vx = (dx / dist) * moveSpeed;
               p.vz = (dz / dist) * moveSpeed;
               p.x += p.vx * ds;
               p.z += p.vz * ds;
               p.y = getTerrainHeight(p.x, p.z);
               p.hurtTimer = Math.max(0, (p.hurtTimer || 0) - delta);
               return;
             }

             p.state = 'repairing';
             p.vx = 0;
             p.vz = 0;
             p.repairTargetX = repairTarget.x;
             p.repairTargetZ = repairTarget.z;
             const repairAmount = (
               repairTarget.type === 'barricade'
                 ? ENGINEER_BARRICADE_REPAIR_RATE
                 : repairTarget.type === 'tank'
                 ? ENGINEER_ARMOR_REPAIR_RATE
                 : ENGINEER_REPAIR_RATE
             ) * delta;
             repairTarget.hp = Math.min(
               repairTarget.maxHp || (repairTarget.type === 'tank' ? TANK_BASE_HP : BUNKER_BASE_HP),
               (repairTarget.hp || 0) + repairAmount
             );
             if (repairTarget.type === 'barricade') {
               repairTarget.expiresAt = Math.max(repairTarget.expiresAt || 0, Date.now() + 6000);
             } else if (repairTarget.type === 'tank' && repairTarget.state === 'broken' && (repairTarget.hp || 0) > (repairTarget.maxHp || TANK_BASE_HP) * 0.34) {
               repairTarget.state = 'driving';
             }
             if (Math.random() < 0.025) {
               AudioManager.play('target_confirm', { volume: 0.04, duration: 0.08 });
             }
             p.hurtTimer = Math.max(0, (p.hurtTimer || 0) - delta);
             return;
           }

           const bestBunker = getBestDeployBunker();
           const aliveKaijus = frameSnapshot.aliveKaijus;
           const canRebuildBarricade = bestBunker && aliveKaijus.length > 0 && (!p.nextBarricadeBuildAt || Date.now() >= p.nextBarricadeBuildAt);
           if (canRebuildBarricade) {
             const nearestActiveBarricade = frameSnapshot.liveBarricades.some((entity) => {
               if (!entity || entity.dead) return false;
               return Math.hypot((entity.x || 0) - bestBunker.x, (entity.z || 0) - bestBunker.z) < 130;
             });
             if (!nearestActiveBarricade) {
               entitiesRef.current.push(createBarricadeEntity(`engineer-barricade-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, bestBunker, { x: p.x, z: p.z }));
               p.nextBarricadeBuildAt = Date.now() + ENGINEER_BARRICADE_REBUILD_COOLDOWN;
               p.state = 'repairing';
               p.repairTargetX = p.x;
               p.repairTargetZ = p.z;
               AudioManager.play('target_confirm', { volume: 0.06, duration: 0.1 });
               p.hurtTimer = Math.max(0, (p.hurtTimer || 0) - delta);
               return;
             }
           }
           p.repairTargetX = undefined;
           p.repairTargetZ = undefined;
         }

         let nearestKaiju = null;
         let minDist = Infinity;
         frameSnapshot.groundKaijus.forEach(k => {
            if (k.type === 'kaiju' && !isKaijuDefeated(k) && !isFlyingKaijuVariant(k.variant)) {
               const kd = Math.sqrt(Math.pow(k.x - p.x, 2) + Math.pow(k.z - p.z, 2));
               if (kd < minDist) { minDist = kd; nearestKaiju = k; }
            }
         });

         if (nearestKaiju && minDist < (p.attackRange || 180) + 30) {
            const dx = nearestKaiju.x - p.x;
            const dz = nearestKaiju.z - p.z;
            const aAngle = Math.atan2(dz, dx);
            p.aimAngle = aAngle;
            const attackRange = p.attackRange || 180;
            const idealRange = p.idealRange || 130;
            const retreatRange = p.retreatRange || 72;
            const combatSpeed = p.combatSpeed || 2.7;

            if (minDist <= attackRange) {
               p.state = 'attacking_kaiju';
               if (minDist < retreatRange) {
                   p.vx = -Math.cos(aAngle) * combatSpeed * 0.8;
                   p.vz = -Math.sin(aAngle) * combatSpeed * 0.8;
                   p.x += p.vx * ds;
                   p.z += p.vz * ds;
               } else if (minDist > idealRange + 18) {
                   p.vx = Math.cos(aAngle) * combatSpeed * 0.65;
                   p.vz = Math.sin(aAngle) * combatSpeed * 0.65;
                   p.x += p.vx * ds;
                   p.z += p.vz * ds;
               } else {
                   p.vx = 0;
                   p.vz = 0;
               }

               if (Math.random() < (p.fireRate || 0.08)) {
                   AudioManager.play('gun', {
                     profile: p.weaponType,
                     volume: p.weaponType === 'marksman' ? 0.2 : p.weaponType === 'gunner' ? 0.14 : 0.17
                   });
                   nearestKaiju.hp -= p.attackDamage || SOLDIER_RIFLE_DAMAGE;
                   if (nearestKaiju.hp <= 0) markKaijuDefeated(nearestKaiju);
                   // Spawn bullet tracer effect
                   entitiesRef.current.push({
                       id: `bullet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                       type: 'bullet',
                       x: p.x, y: 10, z: p.z,
                       targetX: nearestKaiju.x, targetY: nearestKaiju.y + 30, targetZ: nearestKaiju.z,
                       age: 0, dead: false
                   });
               }
            } else {
               p.x += Math.cos(aAngle) * combatSpeed * ds;
               p.z += Math.sin(aAngle) * combatSpeed * ds;
               p.vx = Math.cos(aAngle) * combatSpeed;
               p.vz = Math.sin(aAngle) * combatSpeed;
               p.state = 'walking'; 
            }
         } else if (nearestKaiju) {
           const dx = nearestKaiju.x - p.x;
           const dz = nearestKaiju.z - p.z;
           const aAngle = Math.atan2(dz, dx);
           p.aimAngle = aAngle;
           p.state = 'walking';
           p.vx = Math.cos(aAngle) * (p.combatSpeed || 2.5);
           p.vz = Math.sin(aAngle) * (p.combatSpeed || 2.5);
           p.x += p.vx * ds;
           p.z += p.vz * ds;
         } else if (p.state === 'fleeing') {
          p.x += p.fleeVx * ds;
          p.z += p.fleeVz * ds;
          p.fleeVx *= 0.99; p.fleeVz *= 0.99;
          
          if (p.vy !== undefined) {
             p.y = (p.y || 0) + p.vy * ds;
             p.vy -= 1.0 * ds; // Gravity
             const g = getTerrainHeight(p.x, p.z);
             if (p.y < g) { 
               p.y = g; p.vy = -p.vy * 0.5; // Bounce
               if (Math.abs(p.vy) < 2) p.vy = undefined;
             }
          }
          
          p.idleTimer--;
          
          if (p.x < -WORLD_WIDTH/2 || p.x > WORLD_WIDTH/2 || p.z < -WORLD_DEPTH/2 || p.z > WORLD_DEPTH/2) {
             p.dead = true;
             return;
          }
          if (p.idleTimer <= 0 || (Math.abs(p.fleeVx) < 0.5 && Math.abs(p.fleeVz) < 0.5)) {
            p.state = 'idle';
            p.vx = (Math.random() - 0.5) * 1; p.vz = (Math.random() - 0.5) * 1;
            p.idleTimer = 100 + Math.random() * 200;
          }
        } else if (p.state === 'walking') {
          p.x += p.vx * ds; p.z += p.vz * ds;
          p.idleTimer--;
          if (p.idleTimer <= 0) { p.state = 'idle'; p.idleTimer = 20 + Math.random() * 60; /* Stand briefly */ }
        } else {
          p.idleTimer--;
          if (p.idleTimer <= 0) {
            p.state = 'walking';
            p.vx = (Math.random() - 0.5) * 2; p.vz = (Math.random() - 0.5) * 1.5;
            p.idleTimer = 150 + Math.random() * 300; // Walk for a long time
          }
        }

        p.y = getTerrainHeight(p.x, p.z);
        p.hurtTimer = Math.max(0, (p.hurtTimer || 0) - delta);
        if (p.state !== 'fleeing') {
          if (p.x < -WORLD_WIDTH/2) { p.x = -WORLD_WIDTH/2; p.vx = Math.abs(p.vx); }
          if (p.x > WORLD_WIDTH/2) { p.x = WORLD_WIDTH/2; p.vx = -Math.abs(p.vx); }
          if (p.z < -WORLD_DEPTH/2) { p.z = -WORLD_DEPTH/2; p.vz = Math.abs(p.vz); }
          if (p.z > WORLD_DEPTH/2) { p.z = WORLD_DEPTH/2; p.vz = -Math.abs(p.vz); }
        }
      }
      else if (p.type === 'jet') {
         // Fighter Jet AI - Circle around target until missile fired, then peel out
         p.flightAge = (p.flightAge || 0) + 0.05 * ds;
         
         if (!p.fired) {
            // Seek toward kaiju with sweeping arcs
            const dx = p.targetKaiju.x - p.x;
            const dz = p.targetKaiju.z - p.z;
            const angleToTarget = Math.atan2(dz, dx);
            const currentAngle = Math.atan2(p.vz, p.vx);
            
            // Steer toward target gently
            let diff = angleToTarget - currentAngle;
            // Normalize angle diff
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            
            const newAngle = currentAngle + diff * 0.03 * ds;
            const speed = 12; // High speed
            
            p.vx = Math.cos(newAngle) * speed;
            p.vz = Math.sin(newAngle) * speed;
            
            p.x += p.vx * ds;
            p.z += p.vz * ds;
            
            // Add vertical swoop
            p.y = 200 + Math.sin(p.flightAge) * 100;
            
            // Fire missile when aligned and close enough
            if (Math.abs(diff) < 0.2 && Math.sqrt(dx*dx + dz*dz) < 400) {
                p.fired = true;
                entitiesRef.current.push({
                   id: `missile-${Date.now()}-${Math.random()}`,
                   type: 'missile',
                   x: p.x, y: p.y - 10, z: p.z,
                   targetX: p.targetKaiju.x, 
                   targetY: p.targetKaiju.y + 40,
                   targetZ: p.targetKaiju.z,
                   dead: false
                });
                AudioManager.play('missile_launch');
            }
         } else {
            // Fired! Pull up and peel away sharply
            p.vx *= 1.02; // Accelerate away
            p.vz *= 1.02;
            p.y += 5 * ds; // Climb fast
            p.x += p.vx * ds;
            p.z += p.vz * ds;
         }
         
         // Engine sound
         p.engineSoundTimer = (p.engineSoundTimer || 0) + ds;
         if (p.engineSoundTimer > 60) {
            AudioManager.play('plane_engine', { volume: 0.1 });
            p.engineSoundTimer = 0;
         }
         
         if (p.fired && (Math.abs(p.x) > 3000 || Math.abs(p.z) > 3000 || p.y > 1000)) p.dead = true;
         // Safety despawn
         if (!p.fired && p.flightAge > 30) p.dead = true;
      }
      else if (p.type === 'missile') {
         const dx = p.targetX - p.x;
         const dy = p.targetY - p.y;
         const dz = p.targetZ - p.z;
         const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
         const prevDist = p.prevDist || Infinity;
         
         if (dist < 30 || (dist > prevDist && dist < 150)) {
            p.dead = true;
            entitiesRef.current.push({
               id: `missile-impact-${Date.now()}`,
               type: 'missile_impact',
               x: p.targetX, y: p.targetY, z: p.targetZ,
               dead: false
            });
            
            // Damage Kaiju
            frameSnapshot.aliveKaijus.forEach(k => {
               const kd = Math.sqrt(Math.pow(k.x - p.targetX, 2) + Math.pow(k.z - p.targetZ, 2));
               if (kd < 150) {
                  k.hp -= JET_MISSILE_DAMAGE;
                  if (k.hp <= 0) markKaijuDefeated(k);
               }
            });
            AudioManager.play('bomb');
         } else {
            const speed = 14;
            p.x += (dx / dist) * speed * ds;
            p.y += (dy / dist) * speed * ds;
            p.z += (dz / dist) * speed * ds;
         }
         p.prevDist = dist;
      }
    });
  });

  const deployManualStrike = (target) => {
    const pendingDeploy = targetingRef.current.pendingDeploy;
    if (pendingDeploy) {
      window.dispatchEvent(new CustomEvent('fallout-deploy-unit', {
        detail: {
          unitType: pendingDeploy,
          target: clampStrikeTarget(target)
        }
      }));
      return;
    }
    const pendingBuild = targetingRef.current.pendingBuild;
    if (pendingBuild) {
      window.dispatchEvent(new CustomEvent('fallout-purchase-building', {
        detail: {
          buildingType: pendingBuild,
          target: clampStrikeTarget(target)
        }
      }));
      return;
    }
    if (targetingRef.current.manualStrikeArmed) {
      launchManualStrike(target, { idPrefix: 'plane-manual', speed: 7 });
    }
  };
  const getPointerStrikeTargetFromClient = (clientX, clientY) => {
    const canvas = gl?.domElement;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const normalizedX = (clientX - rect.left) / rect.width;
    const normalizedY = (clientY - rect.top) / rect.height;
    if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) return null;
    pointerNdcRef.current.set(normalizedX * 2 - 1, -(normalizedY * 2 - 1));
    pointerRaycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
    const terrainPoint = getTerrainPointFromRay(pointerRaycasterRef.current.ray);
    if (terrainPoint) return clampStrikeTarget({ x: terrainPoint.x, z: terrainPoint.z });
    return null;
  };
  const syncPointerPreviewTarget = (nextTarget) => {
    if (!nextTarget) return;
    window._falloutMouseTarget = nextTarget;
    if (targetingRef.current.pendingBuild || targetingRef.current.pendingDeploy || targetingRef.current.manualStrikeArmed) {
      window._falloutBuildFallbackTarget = nextTarget;
    }
    if (targetingRef.current.pendingDeploy && deployDragRef.current.active) {
      setDeployDragTarget(nextTarget);
    }
  };

  useEffect(() => {
    const canvas = gl?.domElement;
    if (!canvas) return undefined;

    const resolveActionTarget = (clientX, clientY) => (
      getPointerStrikeTargetFromClient(clientX, clientY)
      || window._falloutBuildPlacementTarget
      || deployDragRef.current.target
      || window._falloutMouseTarget
      || window._falloutBuildFallbackTarget
      || null
    );

    const handleCanvasPointerDown = (event) => {
      if (event.button !== 0) return;
      const nextTarget = getPointerStrikeTargetFromClient(event.clientX, event.clientY);
      if (!nextTarget) return;
      syncPointerPreviewTarget(nextTarget);
      if (targetingRef.current.pendingDeploy) {
        deployDragRef.current.active = true;
        setDeployDragTarget(nextTarget);
        window._falloutDeployDragActive = true;
      }
    };

    const handleCanvasPointerMove = (event) => {
      const nextTarget = getPointerStrikeTargetFromClient(event.clientX, event.clientY);
      if (!nextTarget) return;
      syncPointerPreviewTarget(nextTarget);
    };

    const handleCanvasPointerUp = (event) => {
      if (event.button !== 0) return;
      const nextTarget = resolveActionTarget(event.clientX, event.clientY);
      if (targetingRef.current.pendingDeploy && deployDragRef.current.active) {
        if (nextTarget) deployManualStrike(nextTarget);
        clearDeployDrag();
        return;
      }
      if (targetingRef.current.pendingBuild) {
        if (nextTarget) deployManualStrike(nextTarget);
        return;
      }
      if (targetingRef.current.manualStrikeArmed && nextTarget) {
        deployManualStrike(nextTarget);
      }
    };

    const handleCanvasPointerLeave = () => {
      if (!targetingRef.current.pendingDeploy && !targetingRef.current.pendingBuild && !targetingRef.current.manualStrikeArmed) {
        window._falloutMouseTarget = null;
      }
      if (!deployDragRef.current.active) clearDeployDrag();
    };

    canvas.addEventListener('pointerdown', handleCanvasPointerDown);
    canvas.addEventListener('pointermove', handleCanvasPointerMove);
    canvas.addEventListener('pointerup', handleCanvasPointerUp);
    canvas.addEventListener('pointerleave', handleCanvasPointerLeave);

    return () => {
      canvas.removeEventListener('pointerdown', handleCanvasPointerDown);
      canvas.removeEventListener('pointermove', handleCanvasPointerMove);
      canvas.removeEventListener('pointerup', handleCanvasPointerUp);
      canvas.removeEventListener('pointerleave', handleCanvasPointerLeave);
    };
  }, [camera, gl]);

  if (!mounted) return null;

  return (
    <>
      <DynamicEntitySync entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} frameSnapshotRef={frameSnapshotRef} setGameState={setGameState} qualityProfile={qualityProfile} />
      <DummyWarmup qualityProfile={qualityProfile} />
      {/* PERFECT STATIC RENDER: Only runs once on mount! Everything moves natively via WebGL updates, saving 1500 React node reconciliations! */}
      {entitiesRef.current.map((p, idx) => {
        if (p.type === 'person') return <EntityPerson key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'car') return <EntityCar key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'bird') return <EntityBird key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'house') return <EntityHouse key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'tree') return <EntityTree key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'bunker') return <MemoEntityBunker key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'barricade') return <MemoEntityBarricade key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        return null;
      })}
      {/* RUGGED MOUNTAIN TERRAIN */}
      <MountainTerrain themeConfig={themeConfig} pollution={pollution} qualityProfile={qualityProfile} />

      <TargetIndicator />
    </>
  );
};

// === GAME HUD: Shows bunker HP, military counts, tips ===
const GameHUD = () => {
  const [stats, setStats] = useState({
    bunkers: [],
    tanks: 0,
    soldiers: 0,
    jets: 0,
    kaijus: [],
    credits: 0,
    incomePerSecond: 0,
    nukeCost: MANUAL_STRIKE_COST,
    nukeArmed: false,
    nukeCanArm: true,
    deployCosts: DEPLOY_OPTIONS,
    deployUnlocks: getDeployUnlockState(cloneDefaultBuildings()),
    buildOptions: BUILD_OPTIONS,
    buildState: cloneDefaultBuildings(),
    buildQueue: cloneDefaultBuildQueue(),
    construction: [],
    upgradeOptions: UPGRADE_OPTIONS,
    upgradeState: cloneDefaultUpgrades(),
    wave: {
      level: 1,
      upcomingLevel: 1,
      sectorName: 'Village',
      nextSectorName: 'City',
      totalLevels: TOTAL_KAIJU_LEVELS,
      intermission: false,
      nextWaveSeconds: 0,
      remainingKaijus: 0
    }
  });
  const [targetLock, setTargetLock] = useState(0);
  const [lockStatus, setLockStatus] = useState('TRACKING');
  const [cooldownMs, setCooldownMs] = useState(0);
  const [pendingDeploy, setPendingDeploy] = useState(null);
  const [pendingBuild, setPendingBuild] = useState(null);
  const [bombCamActive, setBombCamActive] = useState(false);
  const [activePanel, setActivePanel] = useState('deploy');
  
  useEffect(() => {
    const interval = setInterval(() => {
      if (window._falloutGameStats) {
        setStats({ ...window._falloutGameStats });
      }
      setTargetLock(window._falloutTargetProgress || 0);
      setCooldownMs(window._falloutStrikeCooldownRemaining || 0);
      const nextPendingDeploy = window._falloutPendingDeploy || null;
      const nextPendingBuild = window._falloutPendingBuild || null;
      const nextBombCamActive = !!window._falloutBombCamActive;
      const deployDragging = !!window._falloutDeployDragActive;
      const buildDragging = !!window._falloutBuildDragActive;
      setPendingDeploy(nextPendingDeploy);
      setPendingBuild(nextPendingBuild);
      setBombCamActive(nextBombCamActive);
      
      if (nextBombCamActive) setLockStatus('GUIDE');
      else if (window._falloutManualStrikeArmed) setLockStatus('NUKE');
      else if (buildDragging) setLockStatus('SITE');
      else if (nextPendingBuild) setLockStatus('BUILD');
      else if (deployDragging) setLockStatus('PATH');
      else if (nextPendingDeploy) setLockStatus('PLACE');
      else if (window._falloutManualStrikeInFlight) setLockStatus('INBOUND');
      else if ((window._falloutStrikeCooldownRemaining || 0) > 0) setLockStatus('REARM');
      else if (window._falloutStrikeReady) setLockStatus('READY');
      else if (window._falloutTargetProgress > 0) setLockStatus('TARGET');
      else setLockStatus('SCAN');
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (pendingBuild) setActivePanel('build');
    else if (pendingDeploy) setActivePanel('deploy');
  }, [pendingBuild, pendingDeploy]);

  const isStrikeLocked = lockStatus === 'READY' || lockStatus === 'INBOUND' || lockStatus === 'PLACE' || lockStatus === 'GUIDE' || lockStatus === 'BUILD' || lockStatus === 'SITE';
  const aliveBunkerCount = stats.bunkers.filter(b => !b.dead).length;
  const activeKaijus = stats.kaijus.filter(k => !k.dead);
  const activeFlyingKaijus = activeKaijus.filter(k => isFlyingKaijuVariant(k.variant));
  const hasAASite = !!stats.buildState?.aa_site;
  const hasBattlefieldPressure = activeKaijus.length > 0 || !!stats.wave?.intermission;
  const missionStepLabel = stats.wave?.intermission
    ? `Step 2/2: Redeploy for Level ${stats.wave?.upcomingLevel || stats.wave?.level || 1}`
    : `Step 1/2: Eliminate ${stats.wave?.remainingKaijus || 0} hostiles`;
  const visibleDeployOptions = Object.entries(stats.deployCosts || DEPLOY_OPTIONS);
  const pendingDeployOption = pendingDeploy ? (stats.deployCosts || DEPLOY_OPTIONS)[pendingDeploy] : null;
  const pendingBuildOption = pendingBuild ? (stats.buildOptions || BUILD_OPTIONS)[pendingBuild] : null;
  const visibleBuildOptions = Object.entries(stats.buildOptions || BUILD_OPTIONS);
  const visibleUpgradeOptions = Object.entries(stats.upgradeOptions || UPGRADE_OPTIONS);
  const buildPlacementState = getBuildPlacementState(stats.buildState || {}, stats.buildQueue || {});
  const constructionByKind = (stats.construction || []).reduce((acc, entry) => {
    acc[entry.kind] = entry;
    return acc;
  }, {});
  const techTreeRows = [
    ['powerplant'],
    ['war_factory', 'field_hospital'],
    ['aa_site', 'tech_lab'],
    ['radar_tower']
  ];
  const unlockSummary = [
    { title: 'Power Grid', tag: 'ECONOMY', building: 'powerplant', unlocks: ['+4/s income', 'Engineers', 'Field Hospital'] },
    { title: 'Armor Line', tag: 'HEAVY', building: 'war_factory', unlocks: ['Tank', 'AA Battery', 'Frontline armor'] },
    { title: 'Medical Wing', tag: 'SUPPORT', building: 'field_hospital', unlocks: ['APC', 'Ranger Drill', 'Repair network'] },
    { title: 'Advanced Tech', tag: 'AIR / TECH', building: 'tech_lab', unlocks: ['Sniper Team', 'Jet', 'Radar Tower'] }
  ];
  const getBuildNodeStatus = (buildingKey) => {
    const built = !!(stats.buildState || {})[buildingKey];
    const queued = !!(stats.buildQueue || {})[buildingKey];
    const selected = pendingBuild === buildingKey;
    const option = (stats.buildOptions || BUILD_OPTIONS)[buildingKey];
    const hasReq = hasPrerequisites(buildPlacementState, option?.requires || []);
    if (built) return 'online';
    if (queued) return 'building';
    if (selected) return 'selected';
    if (!hasReq) return 'locked';
    if (stats.credits < (option?.cost || 0)) return 'waiting';
    return 'ready';
  };
  const handleDeployClick = (unitType) => {
    window.dispatchEvent(new CustomEvent('fallout-select-deploy', { detail: { unitType } }));
  };
  const handleBuildClick = (buildingType) => {
    window.dispatchEvent(new CustomEvent('fallout-select-building', { detail: { buildingType } }));
  };
  const handleUpgradeClick = (upgradeType) => {
    window.dispatchEvent(new CustomEvent('fallout-purchase-upgrade', { detail: { upgradeType } }));
  };
  const handleNukeClick = () => {
    window.dispatchEvent(new CustomEvent('fallout-arm-nuke'));
  };

  const objectiveText = stats.nukeArmed
    ? `Nuke armed: click land to paint target ($${stats.nukeCost || MANUAL_STRIKE_COST})`
    : pendingDeployOption
    ? `Place ${pendingDeployOption.label}: drag path on land`
    : pendingBuildOption
    ? `Place ${pendingBuildOption.label}: click land`
    : activeFlyingKaijus.length > 0 && !hasAASite
    ? 'Flying kaiju spotted: build AA Battery'
    : bombCamActive
    ? 'Bomb cam active: WASD to steer'
    : stats.wave?.intermission
    ? `${stats.wave?.nextSectorName || stats.wave?.sectorName || 'Next Sector'} incoming in ${stats.wave?.nextWaveSeconds || 0}s`
    : 'Hold vaults and eliminate hostiles';

  const card = {
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '12px',
    padding: '8px 10px',
    marginBottom: '6px'
  };

  return (
    <>
      {stats.wave?.intermission && (
        <div
          className="absolute inset-0 z-40 flex items-start justify-center pointer-events-none select-none"
          style={{ fontFamily: "'Courier New', monospace" }}
        >
          <div
            style={{
              marginTop: '68px',
              minWidth: 'min(88vw, 420px)',
              textAlign: 'center',
              borderRadius: '18px',
              border: '1px solid rgba(74,222,128,0.45)',
              background: 'linear-gradient(180deg, rgba(2,44,34,0.88), rgba(0,0,0,0.78))',
              boxShadow: '0 0 34px rgba(34,197,94,0.18)',
              padding: '14px 18px'
            }}
          >
            <div style={{ fontSize: '11px', color: '#86efac', letterSpacing: '0.34em', textTransform: 'uppercase', opacity: 0.9 }}>
              Threat Neutralized
            </div>
            <div style={{ fontSize: '28px', color: '#f0fdf4', letterSpacing: '0.12em', marginTop: '4px', textTransform: 'uppercase' }}>
              Level Clear
            </div>
            <div style={{ fontSize: '12px', color: '#bbf7d0', marginTop: '6px' }}>
              Moving to {stats.wave?.nextSectorName || stats.wave?.sectorName || 'next sector'} for level {stats.wave?.upcomingLevel || stats.wave?.level || 1} in {stats.wave?.nextWaveSeconds || 0}s
            </div>
          </div>
        </div>
      )}
      <div
        className="absolute top-3 left-3 z-30 pointer-events-auto select-none"
        style={{ fontFamily: "'Courier New', monospace", width: 'min(92vw, 320px)' }}
      >
        <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8', letterSpacing: '0.12em' }}>
          <span>STATUS {lockStatus}</span>
          <span>LV {stats.wave?.level || 1}/{stats.wave?.totalLevels || TOTAL_KAIJU_LEVELS}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '12px', color: '#e2e8f0' }}>
          <span>💰 {stats.credits}</span>
          <span>+{stats.incomePerSecond || 0}/s</span>
          <span>{stats.wave?.intermission ? `NEXT ${stats.wave?.nextWaveSeconds || 0}s` : `${stats.wave?.remainingKaijus || 0} HOSTILES`}</span>
        </div>
        <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#86efac', letterSpacing: '0.12em' }}>
          <span>SECTOR {stats.wave?.sectorName || 'Village'}</span>
          <span>{missionStepLabel}</span>
        </div>
        {stats.wave?.intermission && (
          <div style={{ marginTop: '4px', fontSize: '10px', color: '#bbf7d0', letterSpacing: '0.12em' }}>
            NEXT SECTOR {stats.wave?.nextSectorName || stats.wave?.sectorName || 'Village'}
          </div>
        )}
        <button
          onClick={handleNukeClick}
          disabled={!stats.nukeArmed && !stats.nukeCanArm}
          style={{
            marginTop: '8px',
            width: '100%',
            borderRadius: '8px',
            border: stats.nukeArmed ? '1px solid rgba(248,113,113,0.95)' : '1px solid rgba(249,115,22,0.35)',
            background: stats.nukeArmed ? 'rgba(127,29,29,0.45)' : (!stats.nukeCanArm ? 'rgba(255,255,255,0.04)' : 'rgba(154,52,18,0.2)'),
            color: stats.nukeArmed ? '#fee2e2' : (!stats.nukeCanArm ? '#64748b' : '#ffedd5'),
            padding: '7px 8px',
            fontSize: '10px',
            textTransform: 'uppercase',
            display: 'flex',
            justifyContent: 'space-between'
          }}
        >
          <span>{stats.nukeArmed ? 'Cancel Nuke' : 'Arm Nuke'}</span>
          <span>{stats.nukeArmed ? 'ACTIVE' : cooldownMs > 0 ? 'REARM' : `$${stats.nukeCost || MANUAL_STRIKE_COST}`}</span>
        </button>
        {cooldownMs > 0 && (
          <div style={{ marginTop: '6px', height: '4px', borderRadius: '4px', background: '#1f2937', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.max(0, 100 - Math.min(100, (cooldownMs / MANUAL_STRIKE_COOLDOWN_MS) * 100))}%`,
                background: '#f97316'
              }}
            />
          </div>
        )}
        {!cooldownMs && targetLock > 0 && (
          <div style={{ marginTop: '6px', height: '4px', borderRadius: '4px', background: '#1f2937', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.floor(targetLock * 100)}%`, background: '#ef4444' }} />
          </div>
        )}
        <div
          style={{
            marginTop: '8px',
            borderRadius: '8px',
            border: '1px solid rgba(148,163,184,0.16)',
            background: 'rgba(15,23,42,0.55)',
            padding: '6px 8px',
            fontSize: '10px',
            color: '#bfdbfe'
          }}
        >
          {objectiveText}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.14em', marginBottom: '6px' }}>BUNKERS</div>
        {stats.bunkers.map((b, i) => (
          <div key={i} style={{ marginBottom: '5px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: b.hp <= 0 ? '#ef4444' : '#e2e8f0' }}>
              <span>{b.hp <= 0 ? '💀' : '🛡️'} #{i + 1}</span>
              <span>{b.hp <= 0 ? 'DESTROYED' : `${Math.round(b.hp)}/${b.maxHp}`}</span>
            </div>
            <div style={{ height: '4px', background: '#1e293b', borderRadius: '3px', overflow: 'hidden', marginTop: '2px' }}>
              <div
                style={{
                  width: `${Math.max(0, (b.hp / b.maxHp) * 100)}%`,
                  height: '100%',
                  background: b.hp / b.maxHp > 0.5 ? '#22c55e' : b.hp / b.maxHp > 0.2 ? '#eab308' : '#ef4444'
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '8px' }}>
          {[
            { key: 'deploy', label: 'Deploy' },
            { key: 'build', label: 'Build' },
            { key: 'threat', label: `Threat (${activeKaijus.length})` }
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActivePanel(tab.key)}
              style={{
                borderRadius: '8px',
                border: activePanel === tab.key ? '1px solid rgba(16,185,129,0.9)' : '1px solid rgba(148,163,184,0.25)',
                background: activePanel === tab.key ? 'rgba(6,95,70,0.42)' : 'rgba(15,23,42,0.45)',
                color: activePanel === tab.key ? '#ecfdf5' : '#cbd5e1',
                fontSize: '10px',
                padding: '6px 4px'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activePanel === 'deploy' && (
          <>
            <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: '#e2e8f0', marginBottom: '8px' }}>
              <span>🪖 {stats.soldiers}</span>
              <span>🚜 {stats.tanks}</span>
              <span>✈️ {stats.jets}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {visibleDeployOptions.map(([key, option]) => {
                const isUnlocked = (stats.deployUnlocks || {})[key] !== false;
                const blocked = !isUnlocked || stats.credits < option.cost || aliveBunkerCount <= 0 || !hasBattlefieldPressure || !!pendingBuildOption;
                const selected = pendingDeploy === key;
                return (
                  <button
                    key={key}
                    onClick={() => handleDeployClick(key)}
                    disabled={blocked}
                    style={{
                      borderRadius: '9px',
                      border: selected ? '1px solid rgba(110,231,183,0.9)' : '1px solid rgba(74,222,128,0.28)',
                      background: blocked ? 'rgba(255,255,255,0.04)' : selected ? 'rgba(6,95,70,0.45)' : 'rgba(21,128,61,0.14)',
                      color: blocked ? '#64748b' : selected ? '#ecfdf5' : '#dcfce7',
                      padding: '8px 6px',
                      fontSize: '10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      textTransform: 'uppercase'
                    }}
                  >
                    <span>{option.icon} {option.label}</span>
                    <span>{!isUnlocked ? 'LOCK' : selected ? 'READY' : `$${option.cost}`}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {activePanel === 'build' && (
          <>
            <div
              style={{
                borderRadius: '10px',
                border: '1px solid rgba(34,197,94,0.18)',
                background: 'linear-gradient(180deg, rgba(5,46,22,0.38), rgba(15,23,42,0.55))',
                padding: '8px',
                marginBottom: '8px'
              }}
            >
              <div style={{ fontSize: '10px', color: '#86efac', letterSpacing: '0.14em', marginBottom: '6px' }}>TECH TREE</div>
              <div style={{ display: 'grid', gap: '6px' }}>
                {techTreeRows.map((row, rowIndex) => (
                  <div key={`tech-row-${rowIndex}`} style={{ display: 'grid', gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`, gap: '6px' }}>
                    {row.map((buildingKey) => {
                      const option = (stats.buildOptions || BUILD_OPTIONS)[buildingKey];
                      const status = getBuildNodeStatus(buildingKey);
                      const statusLabel =
                        status === 'online' ? 'ONLINE' :
                        status === 'building' ? `${Math.round((constructionByKind[buildingKey]?.progress || 0) * 100)}%` :
                        status === 'selected' ? 'PLACE' :
                        status === 'locked' ? 'LOCK' :
                        status === 'waiting' ? 'SAVE' :
                        'READY';
                      const borderColor =
                        status === 'online' ? 'rgba(74,222,128,0.72)' :
                        status === 'building' ? 'rgba(45,212,191,0.72)' :
                        status === 'selected' ? 'rgba(34,197,94,0.92)' :
                        status === 'locked' ? 'rgba(100,116,139,0.38)' :
                        status === 'waiting' ? 'rgba(250,204,21,0.35)' :
                        'rgba(59,130,246,0.36)';
                      const bgColor =
                        status === 'online' ? 'rgba(21,128,61,0.28)' :
                        status === 'building' ? 'rgba(13,148,136,0.2)' :
                        status === 'selected' ? 'rgba(6,95,70,0.42)' :
                        status === 'locked' ? 'rgba(255,255,255,0.03)' :
                        status === 'waiting' ? 'rgba(113,63,18,0.2)' :
                        'rgba(8,47,73,0.22)';
                      return (
                        <button
                          key={buildingKey}
                          onClick={() => handleBuildClick(buildingKey)}
                          disabled={status === 'online' || status === 'building' || status === 'locked' || status === 'waiting' || aliveBunkerCount <= 0 || !!pendingDeployOption}
                          style={{
                            borderRadius: '9px',
                            border: `1px solid ${borderColor}`,
                            background: bgColor,
                            color: status === 'locked' ? '#64748b' : '#e2e8f0',
                            padding: '7px 6px',
                            textAlign: 'left'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', textTransform: 'uppercase' }}>
                            <span>{option.icon} {option.label}</span>
                            <span>{statusLabel}</span>
                          </div>
                          <div style={{ marginTop: '4px', fontSize: '9px', color: status === 'locked' ? '#475569' : '#93c5fd' }}>
                            {status === 'locked'
                              ? `Needs ${(option.requires || []).map((req) => (stats.buildOptions || BUILD_OPTIONS)[req]?.label || req).join(' + ')}`
                              : option.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gap: '5px', marginTop: '8px' }}>
                {unlockSummary.map((entry) => {
                  const online = !!(stats.buildState || {})[entry.building];
                  return (
                    <div
                      key={`summary-${entry.building}`}
                      style={{
                        borderRadius: '8px',
                        border: `1px solid ${online ? 'rgba(74,222,128,0.35)' : 'rgba(148,163,184,0.16)'}`,
                        background: online ? 'rgba(21,128,61,0.16)' : 'rgba(15,23,42,0.34)',
                        padding: '6px 7px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', textTransform: 'uppercase', color: online ? '#dcfce7' : '#cbd5e1' }}>
                        <span>{entry.title}</span>
                        <span>{online ? 'ACTIVE' : 'LOCKED'}</span>
                      </div>
                      <div style={{ marginTop: '2px', fontSize: '8px', letterSpacing: '0.18em', textTransform: 'uppercase', color: online ? '#6ee7b7' : '#64748b' }}>
                        {entry.tag}
                      </div>
                      <div style={{ marginTop: '3px', fontSize: '9px', color: online ? '#86efac' : '#94a3b8' }}>
                        Unlocks: {entry.unlocks.join(' • ')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {!!(stats.construction || []).length && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px', marginBottom: '8px' }}>
                {(stats.construction || []).map((entry) => (
                  <div
                    key={entry.kind}
                    style={{
                      borderRadius: '9px',
                      border: '1px solid rgba(45,212,191,0.25)',
                      background: 'rgba(15,118,110,0.16)',
                      padding: '7px 8px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', textTransform: 'uppercase', color: '#ccfbf1' }}>
                      <span>{entry.label}</span>
                      <span>{Math.round((entry.progress || 0) * 100)}%</span>
                    </div>
                    <div style={{ marginTop: '5px', height: '5px', borderRadius: '999px', background: 'rgba(15,23,42,0.7)', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.round((entry.progress || 0) * 100)}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg, rgba(45,212,191,0.7), rgba(74,222,128,0.95))'
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }}>
              {visibleBuildOptions.map(([key, option]) => {
                const built = !!(stats.buildState || {})[key];
                const queued = !!(stats.buildQueue || {})[key];
                const construction = constructionByKind[key];
                const hasReq = hasPrerequisites(buildPlacementState, option.requires || []);
                const blocked = built || queued || !hasReq || stats.credits < option.cost || aliveBunkerCount <= 0 || !!pendingDeployOption;
                const selected = pendingBuild === key;
                return (
                  <button
                    key={key}
                    onClick={() => handleBuildClick(key)}
                    disabled={blocked}
                    style={{
                      borderRadius: '9px',
                      border: selected ? '1px solid rgba(20,184,166,0.95)' : '1px solid rgba(56,189,248,0.24)',
                      background: built ? 'rgba(13,148,136,0.2)' : selected ? 'rgba(13,148,136,0.38)' : blocked ? 'rgba(255,255,255,0.04)' : 'rgba(8,145,178,0.14)',
                      color: built ? '#ccfbf1' : blocked ? '#64748b' : '#e0f2fe',
                      padding: '8px 6px',
                      fontSize: '10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      textTransform: 'uppercase'
                    }}
                  >
                    <span>{option.icon} {option.label}</span>
                    <span>{built ? 'ONLINE' : construction ? `${Math.round((construction.progress || 0) * 100)}%` : queued ? 'BUILDING' : selected ? 'PLACE' : !hasReq ? 'LOCK' : `$${option.cost}`}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }}>
              {visibleUpgradeOptions.map(([key, option]) => {
                const purchased = !!(stats.upgradeState || {})[key];
                const hasReq = hasPrerequisites(stats.buildState || {}, option.requires || []);
                const blocked = purchased || !hasReq || stats.credits < option.cost;
                return (
                  <button
                    key={key}
                    onClick={() => handleUpgradeClick(key)}
                    disabled={blocked}
                    style={{
                      borderRadius: '9px',
                      border: purchased ? '1px solid rgba(250,204,21,0.5)' : '1px solid rgba(250,204,21,0.25)',
                      background: purchased ? 'rgba(202,138,4,0.24)' : blocked ? 'rgba(255,255,255,0.04)' : 'rgba(161,98,7,0.18)',
                      color: purchased ? '#fef9c3' : blocked ? '#64748b' : '#fef3c7',
                      padding: '8px 6px',
                      fontSize: '10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      textTransform: 'uppercase'
                    }}
                  >
                    <span>{option.icon} {option.label}</span>
                    <span>{purchased ? 'UPGRADED' : !hasReq ? 'LOCK' : `$${option.cost}`}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {activePanel === 'threat' && (
          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {activeKaijus.length === 0 && (
              <div style={{ fontSize: '10px', color: '#fca5a5', opacity: 0.8 }}>No active kaiju.</div>
            )}
            {activeKaijus.map((k, i) => (
              <div key={i} style={{ marginBottom: '7px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#fca5a5' }}>
                  <span>👹 {k.displayName || getKaijuDisplayName(k.variant)}</span>
                  <span>{`${Math.round(Math.max(0, k.hp))}/${k.maxHp}`}</span>
                </div>
                <div style={{ height: '4px', background: '#450a0a', borderRadius: '3px', overflow: 'hidden', marginTop: '2px' }}>
                  <div
                    style={{
                      width: `${Math.max(0, (Math.max(0, k.hp) / k.maxHp) * 100)}%`,
                      height: '100%',
                      background: '#ef4444'
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </>
  );
};

const SettingsMenu = ({ resolutionPreset, setResolutionPreset }) => {
  const [open, setOpen] = useState(false);
  const currentPreset = RESOLUTION_PRESETS[resolutionPreset] || RESOLUTION_PRESETS[DEFAULT_RESOLUTION_PRESET];

  return (
    <div
      className="absolute right-4 bottom-24 z-50 pointer-events-auto select-none sm:right-6 sm:bottom-28"
      style={{ fontFamily: "'Courier New', monospace" }}
    >
      {open && (
        <div
          className="mb-3 rounded-2xl border border-green-400/35 bg-black/85 p-4 shadow-[0_0_32px_rgba(34,197,94,0.22)] backdrop-blur-md"
          style={{ minWidth: '240px' }}
        >
          <div className="mb-1 text-[10px] font-bold tracking-[0.28em] text-green-300 uppercase">
            Graphics Control
          </div>
          <div className="mb-3 text-[10px] text-green-500/70">
            Current: {currentPreset.label}
          </div>
          <div className="space-y-2">
            {Object.entries(RESOLUTION_PRESETS).map(([key, preset]) => {
              const active = key === resolutionPreset;
              return (
                <button
                  key={key}
                  onClick={() => {
                    setResolutionPreset(key);
                    setOpen(false);
                  }}
                  className={`w-full rounded-xl border px-3 py-2 text-left transition-all ${
                    active
                      ? 'border-green-300/50 bg-green-500/20 text-green-200 shadow-[0_0_18px_rgba(34,197,94,0.18)]'
                      : 'border-white/10 bg-white/5 text-slate-200 hover:border-green-500/20 hover:bg-green-500/8'
                  }`}
                >
                  <div className="text-[11px] font-bold tracking-[0.12em] uppercase">{preset.label}</div>
                  <div className="text-[10px] text-slate-400">{preset.note}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex min-w-[152px] items-center justify-between rounded-2xl border border-green-300/40 bg-black/85 px-4 py-3 text-left text-green-200 shadow-[0_0_28px_rgba(34,197,94,0.24)] backdrop-blur-md transition-all hover:border-green-200/60 hover:shadow-[0_0_36px_rgba(34,197,94,0.32)]"
      >
        <div>
          <div className="text-[9px] tracking-[0.28em] text-green-400/80 uppercase">Settings</div>
          <div className="mt-1 text-[12px] font-bold tracking-[0.12em] uppercase">{currentPreset.label}</div>
        </div>
        <div className="ml-4 rounded-full border border-green-400/30 bg-green-500/10 px-2 py-1 text-[10px] font-bold tracking-[0.16em] uppercase">
          {open ? 'Close' : 'Open'}
        </div>
      </button>
    </div>
  );
};

const NukeImpactOverlay = ({ blastFx }) => {
  if (!blastFx?.active) return null;

  const flashOpacity = Math.max(0, 1 - blastFx.progress * 2.9) * 0.72 * blastFx.intensity;
  const haloOpacity = Math.max(0, 1 - Math.abs(blastFx.progress - 0.18) / 0.24) * 0.42 * blastFx.intensity;
  const ringOpacity = Math.max(0, 1 - blastFx.progress * 1.15) * 0.52 * blastFx.intensity;
  const heatOpacity = Math.max(0, 1 - Math.max(0, blastFx.progress - 0.08) / 0.7) * 0.22 * blastFx.intensity;
  const dustOpacity = Math.max(0, 1 - Math.max(0, blastFx.progress - 0.16) / 0.84) * 0.28 * blastFx.intensity;
  const glareScale = lerpNumber(0.65, 2.35, Math.min(1, blastFx.progress * 1.9));
  const ringScale = lerpNumber(0.2, 2.8, Math.pow(Math.min(1, blastFx.progress * 1.2), 0.72));
  const heatScale = lerpNumber(0.85, 1.65, Math.min(1, blastFx.progress * 1.1));
  const offsetX = `${blastFx.screenX}%`;
  const offsetY = `${blastFx.screenY}%`;

  return (
    <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden">
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: flashOpacity,
          background: 'radial-gradient(circle at center, rgba(255,250,214,0.98) 0%, rgba(255,214,102,0.72) 22%, rgba(255,120,20,0.24) 48%, rgba(0,0,0,0) 82%)',
          mixBlendMode: 'screen'
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: offsetX,
          top: offsetY,
          width: '24vmax',
          height: '24vmax',
          transform: `translate(-50%, -50%) scale(${glareScale})`,
          opacity: haloOpacity,
          borderRadius: '999px',
          background: 'radial-gradient(circle, rgba(255,245,196,0.95) 0%, rgba(255,169,64,0.52) 38%, rgba(255,90,0,0.14) 64%, rgba(0,0,0,0) 78%)',
          filter: 'blur(14px)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: offsetX,
          top: offsetY,
          width: '22vmax',
          height: '22vmax',
          transform: `translate(-50%, -50%) scale(${ringScale})`,
          opacity: ringOpacity,
          borderRadius: '999px',
          border: '2px solid rgba(255,226,122,0.95)',
          boxShadow: '0 0 45px rgba(255,160,64,0.5), inset 0 0 30px rgba(255,230,160,0.18)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: '-10%',
          opacity: heatOpacity,
          transform: `scale(${heatScale})`,
          background: `radial-gradient(circle at ${offsetX} ${offsetY}, rgba(255,210,110,0.22) 0%, rgba(255,120,20,0.1) 14%, rgba(255,255,255,0) 34%),
            repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0 3px, rgba(255,160,64,0.01) 3px 7px, rgba(0,0,0,0) 7px 12px)`,
          filter: 'blur(10px)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: dustOpacity,
          background: `radial-gradient(circle at ${offsetX} ${offsetY}, rgba(255,186,120,0.08) 0%, rgba(120,53,15,0.2) 32%, rgba(0,0,0,0.36) 100%)`,
          mixBlendMode: 'screen'
        }}
      />
    </div>
  );
};

export default function FalloutPeople({ theme, isIdleMode }) {
  const isFallout = (theme === 'retro' || theme === 'fallout') && isIdleMode;
  const { data: session } = useSession();
  
  const [nukeCount, setNukeCount] = useState(0);
  const [activeTheme, setActiveTheme] = useState(null);
  const [gameState, setGameState] = useState('playing'); // 'playing', 'won', 'lost'
  const [retryId, setRetryId] = useState(0);
  const [resolutionPreset, setResolutionPreset] = useState(getInitialResolutionPreset);
  const [currentLevel, setCurrentLevel] = useState(1);
  const [blastFx, setBlastFx] = useState({ active: false, progress: 0, intensity: 0, screenX: 50, screenY: 50 });
  const [stressLevel, setStressLevel] = useState('normal');
  const nukeIdRef = useRef(0);
  const progressBaseRef = useRef(DEFAULT_FALLOUT_PROGRESS);
  const runProgressRef = useRef({ maxLevel: 1, kaijuKills: 0, nukesUsed: 0 });
  const progressLoadedRef = useRef(false);
  const resultSavedRef = useRef(false);
  const lastProgressSignatureRef = useRef('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('fallout-resolution-preset', resolutionPreset);
  }, [resolutionPreset]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isFallout) return undefined;

    let raf = 0;
    let fxStart = 0;
    let fxDuration = 0;

    let lastCommit = 0;
    const updateFx = () => {
      if (!fxStart || !fxDuration) return;
      const now = performance.now();
      const elapsed = now - fxStart;
      const progress = Math.min(1, elapsed / fxDuration);
      if (now - lastCommit >= 33 || progress >= 1) {
        lastCommit = now;
        setBlastFx((prev) => ({
          ...prev,
          active: progress < 1,
          progress
        }));
      }
      if (progress < 1) raf = window.requestAnimationFrame(updateFx);
    };

    const handleExplosion = (event) => {
      const detail = event?.detail || {};
      const intensity = Math.max(0.8, Math.min(1.4, (detail.intensity || 2.4) / 2.2));
      fxStart = performance.now();
      fxDuration = 1150 + intensity * 260;
      setStressLevel('critical');
      setBlastFx({
        active: true,
        progress: 0,
        intensity,
        screenX: 50,
        screenY: 50
      });
      if (raf) window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(updateFx);
    };

    window.addEventListener('fallout-explosion', handleExplosion);
    return () => {
      window.removeEventListener('fallout-explosion', handleExplosion);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [isFallout]);

  const buildProgressPayload = (outcome = 'playing', includeResult = false) => {
    const liveStats = window._falloutGameStats || {};
    const wave = liveStats.wave || {};
    const level = Math.max(1, wave.level || runProgressRef.current.maxLevel || currentLevel || 1);
    const kaijuKills = Math.max(
      runProgressRef.current.kaijuKills || 0,
      Array.isArray(liveStats.kaijus) ? liveStats.kaijus.filter(k => k.dead).length : 0
    );
    const base = progressBaseRef.current || DEFAULT_FALLOUT_PROGRESS;

    return {
      highestLevelReached: Math.max(base.highestLevelReached || 1, runProgressRef.current.maxLevel || 1, level),
      currentLevel: level,
      totalWins: (base.totalWins || 0) + (includeResult && outcome === 'won' ? 1 : 0),
      totalLosses: (base.totalLosses || 0) + (includeResult && outcome === 'lost' ? 1 : 0),
      totalGamesPlayed: (base.totalGamesPlayed || 0) + (includeResult ? 1 : 0),
      totalNukesLaunched: (base.totalNukesLaunched || 0) + (runProgressRef.current.nukesUsed || 0),
      totalKaijuKilled: (base.totalKaijuKilled || 0) + kaijuKills,
      lastOutcome: outcome,
      lastTheme: activeTheme?.name || 'wasteland',
      lastStats: {
        credits: liveStats.credits || 0,
        bunkersAlive: Array.isArray(liveStats.bunkers) ? liveStats.bunkers.filter(b => !b.dead).length : 0,
        remainingKaijus: wave.remainingKaijus || 0,
        level
      }
    };
  };

  const persistFalloutProgress = async ({ outcome = 'playing', includeResult = false, force = false } = {}) => {
    if (!isFallout || !session?.user?.email || !progressLoadedRef.current) return;

    const payload = buildProgressPayload(outcome, includeResult);
    const signature = JSON.stringify(payload);
    if (!force && signature === lastProgressSignatureRef.current) return;

    try {
      const res = await fetch('/api/user/fallout-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) return;
      lastProgressSignatureRef.current = signature;
      if (includeResult) {
        progressBaseRef.current = payload;
        resultSavedRef.current = true;
      }
    } catch (error) {
      console.error('[fallout-progress] save failed:', error);
    }
  };

  useEffect(() => {
    if (!isFallout || !session?.user?.email) {
      progressLoadedRef.current = false;
      progressBaseRef.current = DEFAULT_FALLOUT_PROGRESS;
      runProgressRef.current = { maxLevel: 1, kaijuKills: 0, nukesUsed: 0 };
      resultSavedRef.current = false;
      lastProgressSignatureRef.current = '';
      setCurrentLevel(1);
      return;
    }

    let cancelled = false;

    const loadProgress = async () => {
      try {
        const res = await fetch('/api/user/fallout-progress', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const progress = { ...DEFAULT_FALLOUT_PROGRESS, ...(data?.progress || {}) };
        progressBaseRef.current = progress;
        progressLoadedRef.current = true;
      } catch (error) {
        console.error('[fallout-progress] load failed:', error);
      }
    };

    loadProgress();
    return () => {
      cancelled = true;
    };
  }, [isFallout, session?.user?.email]);

  useEffect(() => {
    if (!isFallout) return;
    const interval = setInterval(() => {
      const stats = window._falloutGameStats;
      if (!stats?.wave) return;
      const level = Math.max(1, stats.wave.level || 1);
      setCurrentLevel(level);
      runProgressRef.current.maxLevel = Math.max(runProgressRef.current.maxLevel || 1, level);
      runProgressRef.current.kaijuKills = Math.max(
        runProgressRef.current.kaijuKills || 0,
        Array.isArray(stats.kaijus) ? stats.kaijus.filter(k => k.dead).length : 0
      );
    }, 500);
    return () => clearInterval(interval);
  }, [isFallout, retryId]);

  useEffect(() => {
    runProgressRef.current.nukesUsed = nukeCount;
  }, [nukeCount]);

  useEffect(() => {
    if (!isFallout || !session?.user?.email || !progressLoadedRef.current || resultSavedRef.current) return;
    const interval = setInterval(() => {
      persistFalloutProgress();
    }, 10000);
    return () => clearInterval(interval);
  }, [isFallout, session?.user?.email, retryId, activeTheme, currentLevel, gameState]);

  useEffect(() => {
    if (gameState !== 'won' && gameState !== 'lost') return;
    if (resultSavedRef.current) return;
    persistFalloutProgress({ outcome: gameState, includeResult: true, force: true });
  }, [gameState]);

  useEffect(() => {
    if (isFallout) {
      setNukeCount(0);
      setGameState('playing');
      setCurrentLevel(1);
      window._nukeInteractionTriggered = false;
      setActiveTheme(THEMES[Math.floor(Math.random() * THEMES.length)]);
      runProgressRef.current = { maxLevel: 1, kaijuKills: 0, nukesUsed: 0 };
      resultSavedRef.current = false;
      lastProgressSignatureRef.current = '';
    } else {
      setActiveTheme(null);
      setGameState('playing');
      setNukeCount(0);
      setCurrentLevel(1);
      // Cleanup audio context and cached noise buffers when game ends
      AudioManager.cleanup();
      window._falloutGameStats = null;
    }
    return () => {
      AudioManager.cleanup();
      window._falloutGameStats = null;
    };
  }, [isFallout]);


  const VICTORY_MESSAGES = [
     "YOU SAVED HUMANITY... But at what cost?",
     "THE BEAST IS DEAD. The city is glowing.",
     "KAIJU ELIMINATED! Enjoy the nuclear winter.",
     "Mankind prevails! (Hope you like radiation.)",
     "Target destroyed. We are the real monsters.",
  ];
  
  const DEFEAT_MESSAGES = [
     "THE KAIJU HAS DESTROYED THE CITY.",
     "HUMANITY HAS FALLEN.",
     "GAME OVER. The beast consumes all.",
     "Our weapons were useless.",
     "The monster reached Ground Zero. We are doomed.",
  ];
  
  // Use useMemo to pick a random message when game state changes to prevent flickering
  const endMessage = useMemo(() => {
     if (gameState === 'won') return VICTORY_MESSAGES[Math.floor(Math.random() * VICTORY_MESSAGES.length)];
     if (gameState === 'lost') return DEFEAT_MESSAGES[Math.floor(Math.random() * DEFEAT_MESSAGES.length)];
     return '';
  }, [gameState]);

  const baseResolutionProfile = getResolutionProfile(resolutionPreset);
  const resolutionProfile = useMemo(
    () => getAdaptiveQualityProfile(baseResolutionProfile, stressLevel),
    [baseResolutionProfile, stressLevel]
  );
  // Progressive Apocalypse Scale (0 = peaceful, 1 = total nuclear winter)
  // Takes 10 massive bombs to completely blot out the sun!
  const pollution = Math.min(nukeCount * 0.1, 1);

  useEffect(() => {
    if (!isFallout) return undefined;
    const interval = setInterval(() => {
      const stats = window._falloutGameStats || {};
      const activeKaijus = Array.isArray(stats.kaijus) ? stats.kaijus.filter(k => !k.dead).length : 0;
      const battlefieldUnits = (stats.soldiers || 0) + (stats.tanks || 0) + (stats.jets || 0);
      const totalDynamicLoad = activeKaijus * 12 + battlefieldUnits;
      const pollutionLoad = pollution > 0.55 ? 10 : pollution > 0.3 ? 4 : 0;
      const blastLoad = blastFx.active ? 12 : 0;
      const totalLoad = totalDynamicLoad + pollutionLoad + blastLoad;
      const nextStress = totalLoad >= 54 ? 'critical' : totalLoad >= 30 ? 'high' : 'normal';
      setStressLevel(prev => (prev === nextStress ? prev : nextStress));
      if (typeof window !== 'undefined') window._falloutPerfMode = nextStress;
    }, 1000);
    return () => clearInterval(interval);
  }, [isFallout, pollution, blastFx.active]);

  if (!activeTheme) return null;
  
  // Sky transitions: blue → amber → bright red → dark red
  const skyStages = pollution < 0.3 
    ? new THREE.Color(activeTheme.skyColor).lerp(new THREE.Color('#d97706'), pollution / 0.3)
    : pollution < 0.6
    ? new THREE.Color('#d97706').lerp(new THREE.Color('#991b1b'), (pollution - 0.3) / 0.3)
    : new THREE.Color('#991b1b').lerp(new THREE.Color('#450a0a'), (pollution - 0.6) / 0.4);
  const bgColor = skyStages.getStyle();
  
  // Ground: green → brown → warm dark gray
  const groundColor = new THREE.Color(activeTheme.groundColor)
    .lerp(new THREE.Color(activeTheme.groundPolluted), Math.min(pollution * 2, 1))
    .lerp(new THREE.Color('#1c1917'), Math.max(0, (pollution - 0.5) * 2))
    .getStyle();
  
  // Sun: yellow → blood red, stays above horizon
  const sunColor = new THREE.Color(activeTheme.sunColor)
    .lerp(new THREE.Color('#dc2626'), pollution)
    .lerp(new THREE.Color('#7f1d1d'), Math.max(0, pollution - 0.7) * 3);
  // Sun always stays above horizon (min 150), sinks with pollution
  const sunY = Math.max(150, 400 * (1 - pollution * 0.8));
  const sunSize = 800 * (1 + pollution * 0.5); // Reduced size for performance
  
  // Fog: slightly transparent so we can still see things
  const fogColor = new THREE.Color(bgColor);
  const fogNear = 1200 - pollution * 600;
  const fogFar = 3000 - pollution * 1000;
  
  // Ambient Brightness (Keeps the scene well-lit even at max pollution)
  const ambientIntensity = Math.max(1.5, 2.0 - pollution * 0.5);
  const directionalIntensity = Math.max(1.0, 1.5 - pollution * 0.5);

  return (
    <div className="fixed inset-0 z-[5] pointer-events-none" style={{ overflow: 'hidden' }}>
      {/* Apocalyptic screen overlay (progressive vignette + color grading) */}
      {pollution > 0.1 && (
        <div 
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background: `radial-gradient(circle, transparent 50%, rgba(0,0,0,${pollution * 0.4}) 100%)`,
            backgroundColor: `rgba(255, 120, 20, ${pollution * 0.1})`
          }}
        />
      )}
      {/* Radioactive dust / ash overlay */}
      {pollution > 0.3 && (
        <div 
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background: `linear-gradient(transparent, rgba(120, 53, 15, ${pollution * 0.15}))`,
            animation: 'fallout-ash-drift 8s linear infinite',
          }}
        />
      )}
      <NukeImpactOverlay blastFx={blastFx} />
      
      <Canvas
         key={`fallout-canvas-${resolutionPreset}`}
         className="w-full h-full pointer-events-auto"
         style={{ imageRendering: resolutionProfile.pixelated ? 'pixelated' : 'auto' }}
         frameloop="always"
         shadows={resolutionProfile.shadows ? 'percentage' : false}
         dpr={resolutionProfile.dpr}
         gl={{
           antialias: resolutionProfile.antialias,
           powerPreference: resolutionProfile.dpr <= 0.5 ? 'low-power' : 'default',
           toneMapping: THREE.ACESFilmicToneMapping,
           toneMappingExposure: 1.2
         }}
         camera={{ position: [0, 400, 600], fov: 60, rotation: [-Math.PI / 8, 0, 0], far: 20000 }}
      >
        {/* === ATMOSPHERIC LIGHTING === */}
        <color attach="background" args={[bgColor]} />
        
        {/* Volumetric fog - intensifies with pollution */}
        <fog attach="fog" args={[fogColor, fogNear, fogFar]} />
        
        {/* Ambient light - warm wasteland tones */}
        <ambientLight 
          intensity={ambientIntensity} 
          color={pollution > 0.5 ? '#ff6b35' : pollution > 0.2 ? '#ffa07a' : '#fff5e6'} 
        />
        
        {/* Main sun - harsh directional with shadows */}
        <directionalLight 
          position={[200, 500, 200]} 
          intensity={directionalIntensity}
          color={pollution > 0.3 ? '#ff8c42' : '#fffaf0'}
          castShadow={resolutionProfile.shadows}
          shadow-mapSize-width={resolutionProfile.shadowMapSize || 256}
          shadow-mapSize-height={resolutionProfile.shadowMapSize || 256}
          shadow-camera-far={2500}
          shadow-camera-left={-800}
          shadow-camera-right={800}
          shadow-camera-top={800}
          shadow-camera-bottom={-800}
          shadow-bias={-0.001}
        />
        
        {/* Secondary fill light - softer, cooler */}
        {resolutionProfile.detailMode !== 'minimal' && (
          <directionalLight 
            position={[-300, 200, -100]} 
            intensity={directionalIntensity * 0.3}
            color="#87ceeb"
          />
        )}
        
        {/* Radioactive glow point lights when pollution is high */}
        {pollution > 0.4 && resolutionProfile.enableRadiationLight && (
          <pointLight 
            position={[0, 100, 0]} 
            intensity={pollution * 0.5}
            color="#39ff14"
            distance={800}
            decay={2}
          />
        )}
        
        {/* Rim light for character definition */}
        {resolutionProfile.detailMode === 'full' && (
          <directionalLight 
            position={[0, 300, -400]} 
            intensity={0.2}
            color={pollution > 0.3 ? '#ff4500' : '#ffd700'}
          />
        )}
        
        <OrbitControls 
          makeDefault 
          enableDamping={true} 
          dampingFactor={0.1}
          maxPolarAngle={Math.PI / 2 - 0.05} 
          minDistance={100} 
          maxDistance={3000} 
          mouseButtons={{
             LEFT: THREE.MOUSE.PAN,
             MIDDLE: THREE.MOUSE.DOLLY,
             RIGHT: THREE.MOUSE.ROTATE
          }}
        />
        
        {/* Sun — optimized size and position */}
        <mesh position={[200, sunY, -8000]}>
           <sphereGeometry args={[sunSize, 12, 12]} />
           <meshBasicMaterial color={sunColor} fog={false} />
        </mesh>
        {/* Radioactive Atmospheric Glow (Single layer for performance) */}
        {pollution > 0.1 && resolutionProfile.enableSunGlow && (
          <mesh position={[200, sunY, -8005]}>
            <sphereGeometry args={[sunSize * 1.8, 12, 8]} />
            <meshBasicMaterial color={sunColor} fog={false} transparent opacity={0.2 + pollution * 0.15} />
          </mesh>
        )}
        
        <VillageScene 
          key={`${retryId}-${resolutionPreset}`}
          themeConfig={activeTheme} 
          setNukeCount={setNukeCount} 
          setGameState={setGameState} 
          pollution={pollution}
          qualityProfile={resolutionProfile}
        />

        {/* Fallout Rain / Ash Particles (Optimized - max 10) */}
        {pollution > 0.2 && Array.from({ length: Math.min(resolutionProfile.ashParticles, Math.floor(pollution * resolutionProfile.ashParticles)) }, (_, i) => (
          <FalloutAshParticle key={`ash-${i}`} index={i} pollution={pollution} />
        ))}
      </Canvas>
      
      {/* === GAME HUD === */}
      {gameState === 'playing' && (
        <GameHUD />
      )}
      <SettingsMenu
        resolutionPreset={resolutionPreset}
        setResolutionPreset={setResolutionPreset}
      />

      {/* Game Over / Victory Overlay */}
      {gameState !== 'playing' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
           <div className="text-center p-12 border border-[var(--text-primary)]/20 shadow-2xl bg-black/50 rounded-2xl max-w-2xl">
              <h1 className={`text-6xl font-black mb-6 tracking-widest uppercase ${gameState === 'won' ? 'text-green-500 drop-shadow-[0_0_20px_rgba(34,197,94,0.6)]' : 'text-red-600 drop-shadow-[0_0_20px_rgba(220,38,38,0.6)]'}`}>
                 {gameState === 'won' ? 'VICTORY' : 'GAME OVER'}
              </h1>
              <p className="text-2xl text-white font-mono uppercase leading-relaxed font-semibold">
                 {endMessage}
              </p>
              <button 
                onClick={() => {
                   progressBaseRef.current = resultSavedRef.current
                     ? progressBaseRef.current
                     : buildProgressPayload(gameState, true);
                   runProgressRef.current = { maxLevel: 1, kaijuKills: 0, nukesUsed: 0 };
                   resultSavedRef.current = false;
                   lastProgressSignatureRef.current = '';
                   setRetryId(r => r + 1);
                   setGameState('playing');
                   setNukeCount(0);
                   setCurrentLevel(1);
                   window._nukeInteractionTriggered = false;
                   setActiveTheme(THEMES[Math.floor(Math.random() * THEMES.length)]);
                }}
                className="mt-12 px-8 py-3 bg-[#450a0a] hover:bg-[#7f1d1d] border border-red-900/50 text-red-500 font-mono text-xl tracking-tighter uppercase rounded-lg transition-all hover:scale-105 active:scale-95 shadow-[0_4px_20px_rgba(220,38,38,0.3)]"
              >
                [ RESET TIMELINE ]
              </button>
              <p className="mt-8 text-xs text-[var(--text-secondary)]/50 font-mono uppercase">Toggle Wasteland off and on to exit perfectly.</p>
           </div>
        </div>
      )}
    </div>
  );
}

// === INTERACTIVE TARGETING VISUALS ===
const TargetIndicator = () => {
   const group = useRef();
   const ring = useRef();
   const centerRing = useRef();
   const crosshairA = useRef();
   const crosshairB = useRef();
   const beamRef = useRef();
   const progressRing = useRef();
   const confirmedGroup = useRef();
   const severePreviewRing = useRef();
   const casualtyPreviewRing = useRef();
   const destructionPreviewRing = useRef();
   const deployPreviewRing = useRef();
   const deployGhost = useRef();
   const deployPath = useRef();
   const deployArrow = useRef();
   const barricadeGhost = useRef();
   const tankGhost = useRef();
   const squadGhost = useRef();
   const buildPreviewRing = useRef();
   const buildGhost = useRef();
   const buildGhostCore = useRef();
   const buildPowerGhost = useRef();
   const buildFactoryGhost = useRef();
   const buildAAGhost = useRef();
   const buildHospitalGhost = useRef();
   const buildTechGhost = useRef();
   const buildRadarGhost = useRef();
   
   useFrame((state) => {
      if (!group.current) return;
      
      const target = window._falloutMouseTarget;
      const progress = window._falloutTargetProgress || 0;
      const isLocked = window._falloutTargetConfirmedFlash;
      const confirmedTarget = window._falloutConfirmedTarget;
      const cooldownRemaining = window._falloutStrikeCooldownRemaining || 0;
      const manualStrikeArmed = !!window._falloutManualStrikeArmed;
      const pendingDeploy = window._falloutPendingDeploy || null;
      const pendingBuild = window._falloutPendingBuild || null;
      const deployAnchor = window._falloutDeployAnchor || null;
      const deployDragActive = !!window._falloutDeployDragActive;
      const deployDragTarget = window._falloutDeployDragTarget || null;
      const buildDragActive = !!window._falloutBuildDragActive;
      const buildDragTarget = window._falloutBuildDragTarget || null;
      const buildFallbackTarget = window._falloutBuildFallbackTarget || null;
      const buildPlacementTarget = window._falloutBuildPlacementTarget || null;
      const buildPlacementValid = !!window._falloutBuildPlacementValid;
      const usingDeployPreview = !!pendingDeploy;
      const usingBuildPreview = !!pendingBuild;
      const usingPlacementPreview = usingDeployPreview || usingBuildPreview;
      const focusTarget = pendingDeploy && deployDragTarget
        ? deployDragTarget
        : pendingBuild
        ? (buildPlacementTarget || buildDragTarget || target || buildFallbackTarget)
        : manualStrikeArmed
        ? target
        : null;

      if (focusTarget) {
         group.current.visible = true;
         group.current.position.set(
           focusTarget.x,
           getTerrainHeight(focusTarget.x, focusTarget.z) + TARGET_INDICATOR_HEIGHT,
           focusTarget.z
         );
         
         const s = 1 + (isLocked ? 0.3 : Math.sin(state.clock.elapsedTime * 6) * 0.1);
         group.current.scale.set(s, s, s);
         
         if (ring.current) ring.current.rotation.z += 0.05;
         if (ring.current) ring.current.visible = !usingPlacementPreview;
         if (centerRing.current) centerRing.current.visible = !usingPlacementPreview;
         if (crosshairA.current) crosshairA.current.visible = !usingPlacementPreview;
         if (crosshairB.current) crosshairB.current.visible = !usingPlacementPreview;
         if (beamRef.current) beamRef.current.visible = !usingPlacementPreview;
         if (progressRing.current) {
            progressRing.current.scale.set(progress, progress, 1);
            progressRing.current.visible = !usingPlacementPreview && progress > 0;
         }
         if (severePreviewRing.current) severePreviewRing.current.visible = !usingPlacementPreview;
         if (casualtyPreviewRing.current) casualtyPreviewRing.current.visible = !usingPlacementPreview;
         if (destructionPreviewRing.current) destructionPreviewRing.current.visible = !usingPlacementPreview;
         if (deployPreviewRing.current) {
           deployPreviewRing.current.visible = !!pendingDeploy;
           const deployScale = 1 + Math.sin(state.clock.elapsedTime * 5) * 0.05;
           deployPreviewRing.current.scale.set(deployScale, deployScale, 1);
         }
         if (buildPreviewRing.current) {
           buildPreviewRing.current.visible = !!pendingBuild;
           const buildScale = 1 + Math.sin(state.clock.elapsedTime * 4.5) * 0.04;
           buildPreviewRing.current.scale.set(buildScale, buildScale, 1);
           if (buildPreviewRing.current.material) {
             buildPreviewRing.current.material.color.set(buildPlacementValid ? '#22c55e' : '#ef4444');
             buildPreviewRing.current.material.opacity = buildPlacementValid ? 0.32 : 0.26;
           }
         }
         if (deployGhost.current) {
           deployGhost.current.visible = !!pendingDeploy;
           if (pendingDeploy) {
             const angle = deployAnchor ? getDeployAngle(deployAnchor, focusTarget) : 0;
             deployGhost.current.rotation.y = -angle + Math.PI / 2;
             const ghostPulse = 0.72 + Math.sin(state.clock.elapsedTime * 7) * 0.08;
             deployGhost.current.scale.setScalar(ghostPulse);
           }
         }
         if (deployPath.current) {
           deployPath.current.visible = !!(pendingDeploy && deployAnchor && focusTarget && (deployDragActive || !!deployDragTarget));
           if (pendingDeploy && deployAnchor && focusTarget) {
             const dx = deployAnchor.x - focusTarget.x;
             const dz = deployAnchor.z - focusTarget.z;
             const dist = Math.max(30, Math.sqrt(dx * dx + dz * dz));
             deployPath.current.position.set(dx * 0.5, 3, dz * 0.5);
             deployPath.current.rotation.y = Math.atan2(dx, dz);
             deployPath.current.scale.set(1, 1, dist / 40);
           }
         }
         if (deployArrow.current) {
           deployArrow.current.visible = !!pendingDeploy;
           if (pendingDeploy && deployAnchor) {
             const angle = getDeployAngle(deployAnchor, focusTarget);
             deployArrow.current.rotation.y = -angle + Math.PI / 2;
             const arrowPulse = 1 + Math.sin(state.clock.elapsedTime * 8) * 0.08;
             deployArrow.current.scale.setScalar(arrowPulse);
           }
         }
         if (barricadeGhost.current) barricadeGhost.current.visible = pendingDeploy === 'barricade';
         if (tankGhost.current) tankGhost.current.visible = pendingDeploy === 'tank';
         if (squadGhost.current) squadGhost.current.visible = pendingDeploy === 'squad';
        if (buildGhost.current) {
          buildGhost.current.visible = !!pendingBuild;
          const ghostPulse = 0.82 + Math.sin(state.clock.elapsedTime * 7.2) * 0.06;
          buildGhost.current.scale.setScalar(ghostPulse);
        }
        if (buildPowerGhost.current) buildPowerGhost.current.visible = pendingBuild === 'powerplant';
        if (buildFactoryGhost.current) buildFactoryGhost.current.visible = pendingBuild === 'war_factory';
        if (buildAAGhost.current) buildAAGhost.current.visible = pendingBuild === 'aa_site';
        if (buildHospitalGhost.current) buildHospitalGhost.current.visible = pendingBuild === 'field_hospital';
        if (buildTechGhost.current) buildTechGhost.current.visible = pendingBuild === 'tech_lab';
        if (buildRadarGhost.current) buildRadarGhost.current.visible = pendingBuild === 'radar_tower';
        if (buildGhostCore.current?.material) {
          buildGhostCore.current.material.color.set(buildPlacementValid ? '#34d399' : '#fb7185');
          buildGhostCore.current.material.opacity = buildPlacementValid ? 0.32 : 0.22;
        }
      } else {
         group.current.visible = false;
      }

      if (confirmedGroup.current) {
        if (confirmedTarget) {
          confirmedGroup.current.visible = true;
          confirmedGroup.current.position.set(
            confirmedTarget.x,
            getTerrainHeight(confirmedTarget.x, confirmedTarget.z) + TARGET_INDICATOR_HEIGHT * 0.4,
            confirmedTarget.z
          );
          const pulse = 1 + Math.sin(state.clock.elapsedTime * 3.5) * 0.04;
          confirmedGroup.current.scale.set(pulse, pulse, pulse);
          confirmedGroup.current.children.forEach((child) => {
            if (child.material) {
              child.material.opacity = cooldownRemaining > 0 ? 0.18 : 0.28;
            }
          });
        } else {
          confirmedGroup.current.visible = false;
        }
      }
   });
   
   return (
      <group ref={group} visible={false} renderOrder={100}>
         <group ref={confirmedGroup} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
            <mesh>
               <ringGeometry args={[88, 101, 64]} />
               <meshBasicMaterial color="#220505" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            <mesh>
               <ringGeometry args={[16, 24, 48]} />
               <meshBasicMaterial color="#2f0b0b" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0, -0.1]}>
               <planeGeometry args={[180, 3]} />
               <meshBasicMaterial color="#220505" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0, -0.1]} rotation={[0, 0, Math.PI / 2]}>
               <planeGeometry args={[180, 3]} />
               <meshBasicMaterial color="#220505" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
         </group>
         <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh ref={destructionPreviewRing}>
               <ringGeometry args={[NUKE_DESTRUCTION_PREVIEW_RADIUS - 3, NUKE_DESTRUCTION_PREVIEW_RADIUS + 3, 96]} />
               <meshBasicMaterial color="#f59e0b" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            <mesh ref={casualtyPreviewRing}>
               <ringGeometry args={[NUKE_CASUALTY_PREVIEW_RADIUS - 3, NUKE_CASUALTY_PREVIEW_RADIUS + 3, 96]} />
               <meshBasicMaterial color="#fb923c" transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            <mesh ref={severePreviewRing}>
               <ringGeometry args={[NUKE_SEVERE_PREVIEW_RADIUS - 4, NUKE_SEVERE_PREVIEW_RADIUS + 4, 96]} />
               <meshBasicMaterial color="#ef4444" transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            <mesh ref={deployPreviewRing} visible={false}>
               <ringGeometry args={[72, 82, 64]} />
               <meshBasicMaterial color="#34d399" transparent opacity={0.26} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            <mesh ref={buildPreviewRing} visible={false}>
               <ringGeometry args={[120, 142, 72]} />
               <meshBasicMaterial color="#22c55e" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            <group ref={deployArrow} visible={false} position={[0, 0, -52]}>
               <mesh rotation={[0, 0, Math.PI]}>
                  <coneGeometry args={[8, 16, 3]} />
                  <meshBasicMaterial color="#6ee7b7" transparent opacity={0.9} depthWrite={false} toneMapped={false} />
               </mesh>
               <mesh position={[0, 0, 18]}>
                  <boxGeometry args={[4, 4, 24]} />
                  <meshBasicMaterial color="#34d399" transparent opacity={0.55} depthWrite={false} toneMapped={false} />
               </mesh>
            </group>
            <group ref={deployGhost} visible={false}>
               <group ref={barricadeGhost} visible={false}>
                  {[[-18, 0], [0, 0], [18, 0]].map(([x, z], idx) => (
                    <group key={`ghost-barricade-${idx}`} position={[x, 10, z]}>
                      <mesh>
                        <boxGeometry args={[12, 18, 6]} />
                        <meshBasicMaterial color="#6ee7b7" transparent opacity={0.22} depthWrite={false} toneMapped={false} />
                      </mesh>
                      <mesh position={[0, -7, 0]}>
                        <boxGeometry args={[15, 4, 8]} />
                        <meshBasicMaterial color="#a7f3d0" transparent opacity={0.18} depthWrite={false} toneMapped={false} />
                      </mesh>
                    </group>
                  ))}
               </group>
               <group ref={tankGhost} visible={false} position={[0, 5, 0]}>
                  <mesh position={[0, 5, 0]}>
                     <boxGeometry args={[22, 8, 34]} />
                     <meshBasicMaterial color="#86efac" transparent opacity={0.2} depthWrite={false} toneMapped={false} />
                  </mesh>
                  <mesh position={[0, 10, 3]}>
                     <boxGeometry args={[12, 5, 14]} />
                     <meshBasicMaterial color="#bbf7d0" transparent opacity={0.18} depthWrite={false} toneMapped={false} />
                  </mesh>
                  <mesh position={[0, 10, 22]} rotation={[Math.PI / 2, 0, 0]}>
                     <cylinderGeometry args={[1.2, 1.2, 20, 8]} />
                     <meshBasicMaterial color="#d1fae5" transparent opacity={0.22} depthWrite={false} toneMapped={false} />
                  </mesh>
               </group>
               <group ref={squadGhost} visible={false} position={[0, 3, 0]}>
                  {[[-12, -10], [12, -8], [-8, 10], [10, 12]].map(([x, z], idx) => (
                    <group key={`ghost-soldier-${idx}`} position={[x, 0, z]}>
                      <mesh position={[0, 4, 0]}>
                         <capsuleGeometry args={[2.2, 6, 4, 8]} />
                         <meshBasicMaterial color="#86efac" transparent opacity={0.22} depthWrite={false} toneMapped={false} />
                      </mesh>
                      <mesh position={[0, 9, 0]}>
                         <sphereGeometry args={[1.8, 8, 8]} />
                         <meshBasicMaterial color="#d1fae5" transparent opacity={0.2} depthWrite={false} toneMapped={false} />
                      </mesh>
                    </group>
                  ))}
               </group>
            </group>
            <group ref={buildGhost} visible={false} position={[0, 8, 0]}>
               <mesh ref={buildGhostCore} position={[0, 1.4, 0]}>
                  <cylinderGeometry args={[68, 68, 2.4, 32]} />
                  <meshBasicMaterial color="#34d399" transparent opacity={0.28} depthWrite={false} toneMapped={false} />
               </mesh>
               <group ref={buildPowerGhost} visible={false}>
                 <mesh position={[0, 14, 0]}>
                   <boxGeometry args={[58, 28, 48]} />
                   <meshBasicMaterial color="#6ee7b7" transparent opacity={0.24} depthWrite={false} toneMapped={false} />
                 </mesh>
                 {[[-14, 36, -8], [14, 36, -8]].map((p, i) => (
                   <mesh key={`build-power-stack-${i}`} position={p}>
                     <cylinderGeometry args={[4, 4, 30, 12]} />
                     <meshBasicMaterial color="#a7f3d0" transparent opacity={0.22} depthWrite={false} toneMapped={false} />
                   </mesh>
                 ))}
               </group>
               <group ref={buildFactoryGhost} visible={false}>
                 <mesh position={[0, 18, 0]}>
                   <boxGeometry args={[74, 36, 56]} />
                   <meshBasicMaterial color="#6ee7b7" transparent opacity={0.24} depthWrite={false} toneMapped={false} />
                 </mesh>
                 <mesh position={[0, 34, -12]}>
                   <boxGeometry args={[48, 10, 22]} />
                   <meshBasicMaterial color="#a7f3d0" transparent opacity={0.2} depthWrite={false} toneMapped={false} />
                 </mesh>
               </group>
               <group ref={buildAAGhost} visible={false}>
                 <mesh position={[0, 11, 0]}>
                   <cylinderGeometry args={[30, 34, 20, 16]} />
                   <meshBasicMaterial color="#6ee7b7" transparent opacity={0.24} depthWrite={false} toneMapped={false} />
                 </mesh>
                 <mesh position={[0, 27, 0]}>
                   <boxGeometry args={[28, 8, 20]} />
                   <meshBasicMaterial color="#a7f3d0" transparent opacity={0.2} depthWrite={false} toneMapped={false} />
                 </mesh>
               </group>
               <group ref={buildHospitalGhost} visible={false}>
                 <mesh position={[0, 14, 0]}>
                   <boxGeometry args={[58, 28, 52]} />
                   <meshBasicMaterial color="#6ee7b7" transparent opacity={0.24} depthWrite={false} toneMapped={false} />
                 </mesh>
                 <mesh position={[0, 28, 18]}>
                   <boxGeometry args={[14, 14, 4]} />
                   <meshBasicMaterial color="#a7f3d0" transparent opacity={0.2} depthWrite={false} toneMapped={false} />
                 </mesh>
               </group>
               <group ref={buildTechGhost} visible={false}>
                 <mesh position={[0, 16, 0]}>
                   <cylinderGeometry args={[26, 30, 32, 16]} />
                   <meshBasicMaterial color="#6ee7b7" transparent opacity={0.24} depthWrite={false} toneMapped={false} />
                 </mesh>
                 <mesh position={[0, 38, 0]}>
                   <cylinderGeometry args={[14, 16, 12, 16]} />
                   <meshBasicMaterial color="#a7f3d0" transparent opacity={0.2} depthWrite={false} toneMapped={false} />
                 </mesh>
               </group>
               <group ref={buildRadarGhost} visible={false}>
                 <mesh position={[0, 11, 0]}>
                   <cylinderGeometry args={[22, 28, 20, 16]} />
                   <meshBasicMaterial color="#6ee7b7" transparent opacity={0.24} depthWrite={false} toneMapped={false} />
                 </mesh>
                 <mesh position={[0, 36, 0]}>
                   <cylinderGeometry args={[3.8, 3.8, 38, 12]} />
                   <meshBasicMaterial color="#a7f3d0" transparent opacity={0.2} depthWrite={false} toneMapped={false} />
                 </mesh>
               </group>
            </group>
            <group ref={deployPath} visible={false}>
               <mesh position={[0, 2, 0]}>
                  <boxGeometry args={[8, 2, 40]} />
                  <meshBasicMaterial color="#14532d" transparent opacity={0.2} depthWrite={false} toneMapped={false} />
               </mesh>
               <mesh position={[0, 2.1, 0]}>
                  <planeGeometry args={[5, 40]} />
                  <meshBasicMaterial color="#6ee7b7" transparent opacity={0.32} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
               </mesh>
            </group>
            {/* Base Outter Ring */}
            <mesh ref={ring}>
               <ringGeometry args={[65, 75, 64]} />
               <meshBasicMaterial color="#ef4444" transparent opacity={0.75} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            {/* Progress Circular Feed */}
            <mesh ref={progressRing} visible={false}>
               <ringGeometry args={[78, 85, 96]} />
               <meshBasicMaterial color="#f87171" transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            <mesh ref={centerRing}>
               <ringGeometry args={[10, 15, 64]} />
               <meshBasicMaterial color="#ef4444" side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            <mesh ref={crosshairA} position={[0,0,0.1]}>
               <planeGeometry args={[150, 2]} />
               <meshBasicMaterial color="#ef4444" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            <mesh ref={crosshairB} position={[0,0,0.1]} rotation={[0,0,Math.PI/2]}>
               <planeGeometry args={[150, 2]} />
               <meshBasicMaterial color="#ef4444" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
         </group>
         <mesh ref={beamRef} position={[0, 500, 0]}>
            <cylinderGeometry args={[2, 2, 1000]} />
            <meshBasicMaterial color="#ef4444" transparent opacity={0.12} depthWrite={false} depthTest={false} toneMapped={false} />
         </mesh>
      </group>
   );
};

// Falling ash / radioactive debris particles in the 3D sky
const FalloutAshParticle = ({ index, pollution }) => {
  const ref = useRef();
  const speed = useRef(0.5 + Math.random() * 1.5);
  const startX = useRef((Math.random() - 0.5) * WORLD_WIDTH * 2);
  const startZ = useRef((Math.random() - 0.5) * WORLD_DEPTH * 2);
  const drift = useRef((Math.random() - 0.5) * 0.5);
  const startY = useRef(200 + Math.random() * 200);
  const size = useRef(2 + Math.random() * 4);
  const frameSkip = useRef(index % 2);
  
  useFrame((state) => {
    if (!ref.current) return;
    frameSkip.current = (frameSkip.current + 1) % 2;
    if (frameSkip.current !== 0) return;
    ref.current.position.y -= speed.current;
    ref.current.position.x += drift.current;
    ref.current.rotation.x += 0.01;
    ref.current.rotation.z += 0.005;
    // Reset when below ground
    if (ref.current.position.y < -10) {
      ref.current.position.y = 350 + Math.random() * 100;
      ref.current.position.x = startX.current + (Math.random() - 0.5) * 200;
      ref.current.position.z = startZ.current + (Math.random() - 0.5) * 200;
    }
  });
  
  const shade = pollution > 0.6 ? '#292524' : '#78716c';
  
  return (
    <mesh 
      ref={ref} 
      position={[startX.current, startY.current, startZ.current]}
    >
      <boxGeometry args={[size.current, size.current * 0.4, size.current * 0.4]} />
      <meshBasicMaterial color={shade} transparent opacity={0.3 + pollution * 0.3} />
    </mesh>
  );
};

const MountainTerrain = memo(({ themeConfig, pollution, qualityProfile }) => {
  // Use useMemo for geometry so it doesn't rebuild every render
  const geometry = useMemo(() => {
    const segments = qualityProfile?.terrainSegments || 96;
    const g = new THREE.PlaneGeometry(WORLD_WIDTH * 4, WORLD_DEPTH * 4, segments, segments);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
       const px = pos.getX(i);
       const pz = pos.getY(i); // PlaneGeometry's Y is actually Z in 3D scene after rotation
       pos.setZ(i, getTerrainHeight(px, -pz)); 
    }
    g.computeVertexNormals();
    return g;
  }, [qualityProfile?.terrainSegments]);

  // Generate terrain texture with procedural details
  const terrainTexture = useMemo(() => {
    const textureSize = qualityProfile?.terrainTextureSize || 1024;
    const terrainPatchCount = qualityProfile?.terrainPatchCount || 200;
    const terrainCrackCount = qualityProfile?.terrainCrackCount || 50;
    const terrainDebrisCount = qualityProfile?.terrainDebrisCount || 500;
    const canvas = document.createElement('canvas');
    canvas.width = textureSize;
    canvas.height = textureSize;
    const ctx = canvas.getContext('2d');
    
    // Base terrain color logic - brighten the default wasteland look
    const baseColor = themeConfig?.biome === 'wasteland' ? '#4a3d2e' : '#2d4c1e';
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, textureSize, textureSize);
    
    // Add grass/dirt variation patches
    for (let i = 0; i < terrainPatchCount; i++) {
        const x = Math.random() * textureSize;
        const y = Math.random() * textureSize;
        const r = 10 + Math.random() * 40;
        const shade = Math.random() > 0.5 ? '#5c6d31' : '#3a4a1c';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = shade;
        ctx.globalAlpha = 0.3;
        ctx.fill();
    }
    
    // Add dirt/cracks pattern
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = '#2a1f18';
    ctx.lineWidth = 1;
    for (let i = 0; i < terrainCrackCount; i++) {
        ctx.beginPath();
        let x = Math.random() * textureSize;
        let y = Math.random() * textureSize;
        ctx.moveTo(x, y);
        for (let j = 0; j < 5; j++) {
            x += (Math.random() - 0.5) * (textureSize * 0.1);
            y += (Math.random() - 0.5) * (textureSize * 0.1);
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    
    // Add small debris/stones
    ctx.globalAlpha = 0.2;
    for (let i = 0; i < terrainDebrisCount; i++) {
        const x = Math.random() * textureSize;
        const y = Math.random() * textureSize;
        const size = 1 + Math.random() * 3;
        ctx.fillStyle = Math.random() > 0.5 ? '#6a5a45' : '#4d453b';
        ctx.fillRect(x, y, size, size);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 8);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = qualityProfile?.terrainAnisotropy || 8;
    texture.needsUpdate = true;
    return texture;
  }, [themeConfig, qualityProfile]);

  const burnMarks = useMemo(() => (
    [...Array(qualityProfile?.burnMarkCount || 8)].map(() => ({
      x: (Math.random() - 0.5) * WORLD_WIDTH,
      z: (Math.random() - 0.5) * WORLD_DEPTH,
      radius: 30 + Math.random() * 50,
      opacity: 0.3 + Math.random() * 0.2
    }))
  ), [qualityProfile?.burnMarkCount]);

  return (
    <group>
      <mesh 
         geometry={geometry} 
         rotation={[-Math.PI / 2, 0, 0]} 
         position={[0, 0, 0]}
         receiveShadow={qualityProfile?.shadows}
      >
         <meshStandardMaterial 
            map={terrainTexture}
            color={themeConfig?.biome === 'wasteland' ? '#6b5742' : '#3a5f27'} 
            roughness={0.9} 
            metalness={0.05}
            flatShading={false}
         />
      </mesh>
      
      {/* Scorched ground overlay for pollution (Significantly brightened from pitch black) */}
      {pollution > 0.3 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]}>
          <planeGeometry args={[WORLD_WIDTH * 4, WORLD_DEPTH * 4]} />
          <meshStandardMaterial 
            color="#3b2210"
            roughness={1}
            transparent
            opacity={pollution * 0.25}
          />
        </mesh>
      )}
      
      {/* Burn marks / destruction zones */}
      {pollution > 0.5 && (
        <group>
          {burnMarks.map((mark, i) => (
            <mesh 
              key={`burn-${i}`}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[mark.x, 0.3, mark.z]}
            >
              <circleGeometry args={[mark.radius, 16]} />
              <meshStandardMaterial 
                color="#0c0805"
                roughness={1}
                transparent
                opacity={mark.opacity}
              />
            </mesh>
          ))}
        </group>
      )}
      
      {/* Add a slightly darker base under the hills to avoid floating artifacts */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -20, 0]}>
         <planeGeometry args={[WORLD_WIDTH * 4, WORLD_DEPTH * 4]} />
         <meshBasicMaterial color="#000" />
      </mesh>
    </group>
  );
});
