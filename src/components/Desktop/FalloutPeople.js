'use client';

import { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
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

const getTerrainPointFromRay = (ray, maxDistance = 12000, steps = 128) => {
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

const getVaultEntryPoint = (bunker) => {
  if (!bunker) return { x: 0, z: 42 };
  if (bunker.type === 'facility') {
    if (bunker.kind === 'war_factory') return { x: bunker.x, z: bunker.z + 54 };
    if (bunker.kind === 'field_hospital') return { x: bunker.x + 10, z: bunker.z + 40 };
    if (bunker.kind === 'tech_lab') return { x: bunker.x, z: bunker.z + 48 };
    if (bunker.kind === 'powerplant') return { x: bunker.x - 8, z: bunker.z + 44 };
    if (bunker.kind === 'radar_tower') return { x: bunker.x, z: bunker.z + 46 };
    return { x: bunker.x, z: bunker.z + 42 };
  }
  return {
    x: bunker.x,
    z: bunker.z + 42
  };
};

const getDeployAngle = (bunker, target) => {
  if (!bunker || !target) return -Math.PI / 2;
  return Math.atan2(target.z - bunker.z, target.x - bunker.x);
};

const PLANE_MODEL_SCALE = 0.6;
const JET_MODEL_SCALE = 0.58;
const GROUND_ARMOR_MODEL_SCALE = 0.4;
const TANK_VISUAL_SCALE_MULTIPLIER = 1.38;
const APC_VISUAL_SCALE_MULTIPLIER = 1.14;
const SOLDIER_MODEL_SCALE = 0.9;
const SOLDIER_MOVE_SPEED_MULTIPLIER = 0.78;
const TANK_MOVE_SPEED_MULTIPLIER = 0.82;
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
const TANK_HULL_TURN_RATE = 4.4;
const TANK_IDLE_TURN_RATE = 2.2;
const TANK_TURRET_TURN_RATE = 6.8;
const TANK_MODEL_RECOIL_DISTANCE = 3.1;
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
const ORBITAL_LANCE_COST = 72;
const FIRESTORM_COST = 64;
const WARTHOG_COST = 110;
const ORBITAL_LANCE_COOLDOWN_MS = 10500;
const FIRESTORM_COOLDOWN_MS = 9200;
const WARTHOG_COOLDOWN_MS = 22000;
const WARTHOG_MODEL_SCALE = 0.82;
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
const KAIJU_ATTACK_POSE_SECONDS = 0.62;
const KAIJU_SMASH_POSE_SECONDS = 0.78;
const KAIJU_SPECIAL_WINDUP_SECONDS = 0.72;
const KAIJU_SPECIAL_PULSE_SECONDS = 1.1;
const BARRICADE_LIFETIME_MS = 38000;
const BARRICADE_MAX_HP = 860;
const DEPLOY_OPTIONS = {
  squad: { label: 'Rangers', icon: '🪖', cost: 28, countLabel: 'x4', description: 'Cheap rifle squad that holds the line.' },
  gunner_team: { label: 'Gunner Team', icon: '🔫', cost: 44, countLabel: 'x3', description: 'Auto-rifle team with stronger close suppression.' },
  sniper_team: { label: 'Sniper Team', icon: '🎯', cost: 52, countLabel: 'x2', description: 'Long-range marksmen for high-value kaiju damage.' },
  rpg_team: { label: 'RPG Team', icon: '💥', cost: 64, countLabel: 'x2', description: 'Heavy anti-kaiju rockets with strong burst damage.' },
  missile_team: { label: 'Missile Team', icon: '🚀', cost: 88, countLabel: 'x2', description: 'Long-range guided missiles for elite monster hunting.' },
  engineer_team: { label: 'Engineers', icon: '🛠️', cost: 48, countLabel: 'x2', description: 'Support crew that repairs vaults and defenses.' },
  barricade: { label: 'Barricade', icon: '🧱', cost: 40, countLabel: 'x1', description: 'Temporary wall that slows kaiju pushes.' },
  tank: { label: 'Tank', icon: '🚜', cost: 72, countLabel: 'x1', description: 'Strong anti-kaiju armor for mid range.' },
  apc: { label: 'APC', icon: '🚛', cost: 96, countLabel: 'x1', description: 'Fast support armor that repositions and fires quickly.' },
  jet: { label: 'Jet', icon: '✈️', cost: 120, countLabel: 'x1', description: 'Fast strike support against wounded targets.' }
};
const DEPLOY_TRAINING_DURATIONS = {
  squad: 4.2,
  gunner_team: 5.1,
  sniper_team: 5.8,
  rpg_team: 6.2,
  missile_team: 7.6,
  engineer_team: 4.8,
  tank: 8.2,
  apc: 7.2,
  jet: 9.2
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
const FACILITY_INTERACTION_OPTIONS = {
  powerplant: {
    label: 'Grid Overdrive',
    tag: 'Economy',
    cost: 36,
    cooldownMs: 26000,
    durationMs: 14000,
    description: 'Boosts credits and speeds production from the grid.'
  },
  war_factory: {
    label: 'Battle Refit',
    tag: 'Armor',
    cost: 42,
    cooldownMs: 24000,
    durationMs: 12000,
    description: 'Repairs armor near the factory and accelerates heavy output.'
  },
  aa_site: {
    label: 'Flak Surge',
    tag: 'AA',
    cost: 32,
    cooldownMs: 18000,
    durationMs: 10000,
    description: 'Temporarily increases anti-air fire rate and damage.'
  },
  field_hospital: {
    label: 'Triage Pulse',
    tag: 'Support',
    cost: 34,
    cooldownMs: 19000,
    durationMs: 12000,
    description: 'Supercharges frontline healing around the hospital.'
  },
  tech_lab: {
    label: 'Uplink Burst',
    tag: 'Tech',
    cost: 44,
    cooldownMs: 22000,
    durationMs: 12000,
    description: 'Cuts strike cooldowns and improves advanced training.'
  },
  radar_tower: {
    label: 'Threat Scan',
    tag: 'Intel',
    cost: 28,
    cooldownMs: 20000,
    durationMs: 12000,
    description: 'Marks active kaiju and improves battlefield coordination.'
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
  rpg_team: ['war_factory'],
  missile_team: ['tech_lab', 'war_factory'],
  engineer_team: ['powerplant'],
  barricade: [],
  tank: ['war_factory'],
  apc: ['war_factory', 'field_hospital'],
  jet: ['tech_lab']
};
const BUILDING_DEPLOY_OPTIONS = {
  powerplant: ['squad', 'gunner_team', 'engineer_team', 'barricade'],
  war_factory: ['tank', 'apc', 'rpg_team', 'barricade'],
  field_hospital: ['squad', 'engineer_team', 'apc'],
  tech_lab: ['sniper_team', 'gunner_team', 'missile_team', 'jet'],
  radar_tower: ['jet'],
  aa_site: []
};
const UNIT_PRODUCTION_SOURCES = {
  squad: ['powerplant', 'field_hospital'],
  gunner_team: ['powerplant', 'tech_lab'],
  sniper_team: ['tech_lab'],
  rpg_team: ['war_factory'],
  missile_team: ['tech_lab'],
  engineer_team: ['powerplant', 'field_hospital'],
  barricade: ['powerplant', 'war_factory'],
  tank: ['war_factory'],
  apc: ['war_factory', 'field_hospital'],
  jet: ['tech_lab', 'radar_tower']
};
const canBuildingProduceUnit = (buildingKind, unitType) => (
  !!buildingKind && (BUILDING_DEPLOY_OPTIONS[buildingKind] || []).includes(unitType)
);
const getFacilityInteractionOption = (kind) => FACILITY_INTERACTION_OPTIONS[kind] || null;

const isQueuedDeployUnit = (unitType) => unitType !== 'barricade';
const getProductionSourcesForUnit = (unitType) => UNIT_PRODUCTION_SOURCES[unitType] || [];
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
const POWERPLANT_OVERDRIVE_INCOME_PER_SECOND = 18;
const POWERPLANT_OVERDRIVE_TRAINING_MULTIPLIER = 1.35;
const WAR_FACTORY_REFIT_REPAIR = 150;
const WAR_FACTORY_REFIT_RADIUS = 240;
const WAR_FACTORY_TRAINING_MULTIPLIER = 1.55;
const HOSPITAL_TRIAGE_MULTIPLIER = 2.35;
const TECH_LAB_TRAINING_MULTIPLIER = 1.4;
const TECH_LAB_STRIKE_COOLDOWN_MULTIPLIER = 0.82;
const RADAR_SCAN_STRIKE_DAMAGE_MULTIPLIER = 1.12;
const AA_SITE_SURGE_DAMAGE_MULTIPLIER = 1.8;
const AA_SITE_SURGE_RELOAD_MULTIPLIER = 1.85;
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
const SUPPORT_STRIKE_RADAR_COOLDOWN_MULTIPLIER = 0.88;
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
const ORBITAL_LANCE_DURATION = 7.5;
const FIRESTORM_EFFECT_DURATION = 10.0;
const FIRESTORM_PATCH_TTL = 9.5;
const KINETIC_SPEAR_COST = 125;
const KINETIC_SPEAR_COOLDOWN_MS = 18000;
const KINETIC_SPEAR_DURATION = 6.5;
const ELEMENT_ADVANTAGE_DAMAGE_MULTIPLIER = 1.55;
const ELEMENT_RESIST_DAMAGE_MULTIPLIER = 0.74;
const ELEMENT_META = {
  radiation: { label: 'Radiation', shortLabel: 'RAD', color: '#bef264' },
  ion: { label: 'Ion', shortLabel: 'ION', color: '#7dd3fc' },
  fire: { label: 'Thermal', shortLabel: 'FIRE', color: '#fb923c' },
  reactor: { label: 'Reactor', shortLabel: 'CORE', color: '#84cc16' },
  tide: { label: 'Tide', shortLabel: 'TIDE', color: '#60a5fa' },
  bio: { label: 'Bio', shortLabel: 'BIO', color: '#22c55e' },
  armor: { label: 'Armor', shortLabel: 'ARMOR', color: '#cbd5e1' },
  ash: { label: 'Ash', shortLabel: 'ASH', color: '#a78bfa' },
  storm: { label: 'Storm', shortLabel: 'STORM', color: '#facc15' }
};

const cloneDefaultBuildings = () => ({ ...DEFAULT_BUILDINGS });
const cloneDefaultUpgrades = () => ({ ...DEFAULT_UPGRADES });
const cloneDefaultBuildQueue = () => Object.fromEntries(Object.keys(DEFAULT_BUILDINGS).map((key) => [key, false]));
const SUPPORT_STRIKE_OPTIONS = {
  nuke: {
    key: 'nuke',
    label: 'Nuke',
    icon: '☢️',
    cost: MANUAL_STRIKE_COST,
    cooldownMs: MANUAL_STRIKE_COOLDOWN_MS,
    requires: [],
    statusLabel: 'NUKE',
    element: 'radiation',
    description: 'Strategic bomber drop with wide annihilation radius.',
    preview: {
      outerRadius: NUKE_DESTRUCTION_PREVIEW_RADIUS,
      middleRadius: NUKE_CASUALTY_PREVIEW_RADIUS,
      coreRadius: NUKE_SEVERE_PREVIEW_RADIUS,
      ringColor: '#ef4444',
      beamColor: '#f87171',
      accentColor: '#fb923c'
    }
  },
  orbital_lance: {
    key: 'orbital_lance',
    label: 'Orbital Lance',
    icon: '⚡',
    cost: ORBITAL_LANCE_COST,
    cooldownMs: ORBITAL_LANCE_COOLDOWN_MS,
    requires: ['tech_lab'],
    statusLabel: 'LANCE',
    element: 'ion',
    description: 'Precision satellite beam that punches through clustered kaiju.',
    preview: {
      outerRadius: 190,
      middleRadius: 120,
      coreRadius: 74,
      ringColor: '#38bdf8',
      beamColor: '#67e8f9',
      accentColor: '#93c5fd'
    }
  },
  firestorm: {
    key: 'firestorm',
    label: 'Firestorm',
    icon: '🔥',
    cost: FIRESTORM_COST,
    cooldownMs: FIRESTORM_COOLDOWN_MS,
    requires: ['powerplant'],
    statusLabel: 'FIRE',
    element: 'fire',
    description: 'Incendiary strike that blankets the ground in burning fuel.',
    preview: {
      outerRadius: 250,
      middleRadius: 165,
      coreRadius: 96,
      ringColor: '#f97316',
      beamColor: '#fb923c',
      accentColor: '#facc15'
    }
  },
  kinetic_spear: {
    key: 'kinetic_spear',
    label: 'Kinetic Spear',
    icon: '☄️',
    cost: KINETIC_SPEAR_COST,
    cooldownMs: KINETIC_SPEAR_COOLDOWN_MS,
    requires: ['tech_lab', 'radar_tower'],
    statusLabel: 'SPEAR',
    element: 'ion',
    description: 'Single-target orbital penetrator that devastates one kaiju with a focused strike.',
    preview: {
      outerRadius: 120,
      middleRadius: 72,
      coreRadius: 32,
      ringColor: '#e2e8f0',
      beamColor: '#f8fafc',
      accentColor: '#7dd3fc'
    }
  },
  warthog_run: {
    key: 'warthog_run',
    label: 'A-10 Warthog',
    icon: '🛩️',
    cost: WARTHOG_COST,
    cooldownMs: WARTHOG_COOLDOWN_MS,
    requires: ['tech_lab'],
    statusLabel: 'BRRT',
    element: 'armor',
    description: 'A-10 Warthog strafing run — GAU-8 Avenger saturates a single target with 30mm rounds.',
    preview: {
      outerRadius: 85,
      middleRadius: 52,
      coreRadius: 24,
      ringColor: '#84cc16',
      beamColor: '#a3e635',
      accentColor: '#cbd5e1'
    }
  }
};
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
  rpg_team: hasPrerequisites(buildings, DEPLOY_UNLOCK_REQUIREMENTS.rpg_team),
  missile_team: hasPrerequisites(buildings, DEPLOY_UNLOCK_REQUIREMENTS.missile_team),
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
const SOLDIER_EXPLOSIVE_SPLASH_RADIUS = 125;
const SOLDIER_RPG_DAMAGE = 34;
const SOLDIER_MISSILE_DAMAGE = 58;
const SOLDIER_WEAPON_EQUIP_MS = {
  rifleman: 280,
  marksman: 340,
  gunner: 380,
  rpg: 440,
  missile: 520,
  engineer: 260
};
const SOLDIER_LOADOUTS = [
  {
    key: 'rifleman',
    label: 'Rifle',
    hp: 108,
    attackRange: 200,
    idealRange: 158,
    retreatRange: 104,
    attackDamage: 1.35,
    fireRate: 0.09,
    moveSpeed: 2.05,
    color: '#166534'
  },
  {
    key: 'marksman',
    label: 'Long Range',
    hp: 94,
    attackRange: 310,
    idealRange: 248,
    retreatRange: 162,
    attackDamage: 2.6,
    fireRate: 0.055,
    moveSpeed: 1.82,
    color: '#14532d'
  },
  {
    key: 'gunner',
    label: 'Auto Rifle',
    hp: 122,
    attackRange: 175,
    idealRange: 136,
    retreatRange: 88,
    attackDamage: 0.96,
    fireRate: 0.17,
    moveSpeed: 1.95,
    color: '#3f6212'
  },
  {
    key: 'rpg',
    label: 'RPG',
    hp: 114,
    attackRange: 255,
    idealRange: 214,
    retreatRange: 156,
    attackDamage: SOLDIER_RPG_DAMAGE,
    splashRadius: SOLDIER_EXPLOSIVE_SPLASH_RADIUS,
    projectileType: 'missile',
    fireRate: 0.038,
    moveSpeed: 1.76,
    color: '#854d0e'
  },
  {
    key: 'missile',
    label: 'Missile',
    hp: 102,
    attackRange: 360,
    idealRange: 308,
    retreatRange: 228,
    attackDamage: SOLDIER_MISSILE_DAMAGE,
    splashRadius: SOLDIER_EXPLOSIVE_SPLASH_RADIUS + 20,
    projectileType: 'missile',
    fireRate: 0.026,
    moveSpeed: 1.6,
    color: '#1d4ed8'
  },
  {
    key: 'engineer',
    label: 'Engineer',
    hp: 102,
    attackRange: 120,
    idealRange: 100,
    retreatRange: 60,
    attackDamage: 0.45,
    fireRate: 0.045,
    moveSpeed: 1.9,
    color: '#0f766e'
  }
];
const KAIJU_VARIANT_CONFIG = {
  godzilla: { displayName: 'godzilla', hpMult: 1.12, scaleMin: 4.2, scaleMax: 6.3, moveMult: 0.84, attackMult: 0.9, element: 'reactor', weakAgainst: 'radiation', resistAgainst: 'fire' },
  octopus: { displayName: 'octopus', hpMult: 0.96, scaleMin: 3.9, scaleMax: 5.8, moveMult: 0.8, attackMult: 0.86, element: 'tide', weakAgainst: 'ion', resistAgainst: 'fire' },
  spider: { displayName: 'spider', hpMult: 0.92, scaleMin: 3.7, scaleMax: 5.9, moveMult: 0.88, attackMult: 0.9, element: 'bio', weakAgainst: 'fire', resistAgainst: 'radiation' },
  beetle: { displayName: 'titan beetle', hpMult: 1.08, scaleMin: 4.1, scaleMax: 6.1, moveMult: 0.82, attackMult: 0.92, element: 'armor', weakAgainst: 'ion', resistAgainst: 'fire' },
  wyrm: { displayName: 'ash wyrm', hpMult: 1.02, scaleMin: 4.4, scaleMax: 6.4, moveMult: 0.8, attackMult: 0.9, element: 'ash', weakAgainst: 'radiation', resistAgainst: 'fire' },
  spicie_bird: {
    displayName: 'spicie bird',
    hpMult: 0.88,
    scaleMin: 3.8,
    scaleMax: 5.5,
    moveMult: 0.72,
    attackMult: 0.84,
    element: 'storm',
    weakAgainst: 'ion',
    resistAgainst: 'radiation',
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
  'bullet', 'shell', 'jet', 'warthog', 'missile', 'missile_impact', 'impact_puff',
  'barricade', 'facility', 'soldier', 'tank', 'support_fx', 'kaiju_special_fx',
  'muzzle_flash', 'corpse', 'kaiju_corpse', 'scorch'
]);
const COMMANDABLE_UNIT_TYPES = new Set(['soldier', 'tank']);
const REPAIRABLE_COMMAND_TARGET_TYPES = new Set(['bunker', 'facility', 'barricade', 'tank']);

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

const getSupportStrikeOption = (key) => (
  SUPPORT_STRIKE_OPTIONS[key] || SUPPORT_STRIKE_OPTIONS.nuke
);

const createDefaultSupportCooldownMap = () => Object.fromEntries(
  Object.keys(SUPPORT_STRIKE_OPTIONS)
    .filter((key) => key !== 'nuke')
    .map((key) => [key, 0])
);

const createDefaultSupportCanArmMap = () => Object.fromEntries(
  Object.keys(SUPPORT_STRIKE_OPTIONS).map((key) => [key, key === 'nuke'])
);

const getSupportStrikePreview = (key) => (
  getSupportStrikeOption(key)?.preview || SUPPORT_STRIKE_OPTIONS.nuke.preview
);

const getElementMeta = (element) => (
  ELEMENT_META[element] || { label: String(element || 'unknown').toUpperCase(), shortLabel: String(element || 'UNK').toUpperCase(), color: '#cbd5e1' }
);

const getKaijuVariantTuning = (variant) => (
  KAIJU_VARIANT_CONFIG[variant] || KAIJU_VARIANT_CONFIG.godzilla
);

const getKaijuElementalProfile = (kaijuOrVariant) => {
  const variant = typeof kaijuOrVariant === 'string' ? kaijuOrVariant : kaijuOrVariant?.variant;
  const tuning = getKaijuVariantTuning(variant);
  return {
    element: tuning.element || 'reactor',
    weakAgainst: tuning.weakAgainst || 'radiation',
    resistAgainst: tuning.resistAgainst || null
  };
};

const getKaijuSpecialEffectKind = (variant) => {
  if (variant === 'octopus') return 'ink';
  if (variant === 'spider') return 'web';
  if (variant === 'beetle' || variant === 'spicie_bird') return 'lightning';
  if (variant === 'wyrm') return 'ash';
  return 'reactor';
};

const getKaijuTelegraphColor = (kind = 'reactor') => {
  if (kind === 'ink') return '#7c3aed';
  if (kind === 'web') return '#dbeafe';
  if (kind === 'lightning') return '#67e8f9';
  if (kind === 'smash') return '#fb923c';
  if (kind === 'ash') return '#84cc16';
  return '#f59e0b';
};

const getKaijuSpecialFxPalette = (kind = 'reactor') => {
  if (kind === 'ink') {
    return {
      primary: '#8b5cf6',
      secondary: '#d8b4fe',
      core: '#f5d0fe',
      smoke: '#3b0764'
    };
  }
  if (kind === 'web') {
    return {
      primary: '#e0f2fe',
      secondary: '#93c5fd',
      core: '#ffffff',
      smoke: '#cbd5e1'
    };
  }
  if (kind === 'lightning') {
    return {
      primary: '#67e8f9',
      secondary: '#0ea5e9',
      core: '#ecfeff',
      smoke: '#0f172a'
    };
  }
  if (kind === 'ash') {
    return {
      primary: '#84cc16',
      secondary: '#bef264',
      core: '#f7fee7',
      smoke: '#1a2e05'
    };
  }
  return {
    primary: '#fb923c',
    secondary: '#facc15',
    core: '#fff7ed',
    smoke: '#4a1d0d'
  };
};

const spawnKaijuSpecialFxEntity = (entities, kaiju, phase = 'burst', options = {}) => {
  if (!entities || !kaiju) return null;
  const kind = options.kind || kaiju.specialEffectKind || getKaijuSpecialEffectKind(kaiju.variant);
  const baseScale = Math.max(1.8, kaiju.scale || 5);
  const effect = {
    id: `kaiju-special-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'kaiju_special_fx',
    sourceId: kaiju.id,
    variant: kaiju.variant,
    kind,
    phase,
    x: kaiju.x,
    y: kaiju.y || getTerrainHeight(kaiju.x, kaiju.z),
    z: kaiju.z,
    scale: baseScale,
    duration: options.duration || (phase === 'charge' ? KAIJU_SPECIAL_WINDUP_SECONDS : KAIJU_SPECIAL_PULSE_SECONDS),
    dead: false
  };
  entities.push(effect);
  return effect;
};

const getStrikeElementKey = (abilityKey = 'nuke') => (
  getSupportStrikeOption(abilityKey)?.element || 'radiation'
);

const getElementalStrikeModifier = (abilityKey, kaiju) => {
  const attackElement = getStrikeElementKey(abilityKey);
  const profile = getKaijuElementalProfile(kaiju);
  if (profile.weakAgainst === attackElement) {
    return { multiplier: ELEMENT_ADVANTAGE_DAMAGE_MULTIPLIER, state: 'advantage', attackElement, profile };
  }
  if (profile.resistAgainst === attackElement) {
    return { multiplier: ELEMENT_RESIST_DAMAGE_MULTIPLIER, state: 'resist', attackElement, profile };
  }
  return { multiplier: 1, state: 'neutral', attackElement, profile };
};

const applyKaijuElementalDamage = (kaiju, baseDamage, abilityKey) => {
  if (!kaiju || kaiju.dead) return 0;
  const modifier = getElementalStrikeModifier(abilityKey, kaiju);
  const appliedDamage = baseDamage * modifier.multiplier;
  kaiju.hp -= appliedDamage;
  kaiju.lastElementState = modifier.state;
  kaiju.lastElement = modifier.attackElement;
  kaiju.lastElementHitAt = Date.now();
  return appliedDamage;
};

const getFrameScaledStep = (delta, referenceFps = KAIJU_FRAME_RATE_REFERENCE) => (
  THREE.MathUtils.clamp((delta || 1 / referenceFps) * referenceFps, 0.55, 1.6)
);

const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

const dampAngle = (current, target, rate, delta) => (
  current + wrapAngle(target - current) * Math.min(1, (delta || 0) * rate)
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
const getUnitTypeName = (unit) => {
  if (!unit) return 'Unit';
  if (unit.type === 'tank') return unit.variant === 'apc' ? 'APC' : 'Battle Tank';
  if (unit.type === 'soldier') {
    const loadout = (SOLDIER_LOADOUTS || []).find(l => l.key === unit.weaponType);
    return loadout ? loadout.label : 'Soldier';
  }
  return unit.type.charAt(0).toUpperCase() + unit.type.slice(1);
};

const showCommandFeedback = (text) => {
  if (typeof window !== 'undefined') {
    window._falloutCommandFeedback = { text, at: Date.now() };
    window.dispatchEvent(new CustomEvent('fallout-command-feedback', { detail: { text } }));
  }
};
const isCommandableUnit = (entity) => !!entity && COMMANDABLE_UNIT_TYPES.has(entity.type) && !entity.dead;
const isRepairableCommandTarget = (entity) => {
  if (!entity || entity.dead || !REPAIRABLE_COMMAND_TARGET_TYPES.has(entity.type)) return false;
  if (entity.type === 'bunker') return !isBrokenStructure(entity) && (entity.hp || 0) < (entity.maxHp || BUNKER_BASE_HP);
  if (entity.type === 'facility') return !isBrokenStructure(entity) && (entity.hp || 0) < (entity.maxHp || 1000);
  if (entity.type === 'barricade') return (entity.hp || 0) < (entity.maxHp || BARRICADE_MAX_HP);
  if (entity.type === 'tank') return (entity.hp || 0) < (entity.maxHp || TANK_BASE_HP);
  return false;
};
const clearUnitOrder = (unit) => {
  if (!unit) return;
  unit.orderType = 'hold';
  unit.orderTargetId = undefined;
  unit.orderX = undefined;
  unit.orderZ = undefined;
  unit.commandTargetX = undefined;
  unit.commandTargetZ = undefined;
  unit.attackFormationAngle = undefined;
  unit.attackFormationRadius = undefined;
  unit.attackFormationRow = undefined;
  if (unit.type === 'soldier' && unit.weaponType === 'engineer') {
    unit.repairTargetX = undefined;
    unit.repairTargetZ = undefined;
  }
};
const issueMoveOrder = (unit, target) => {
  if (!unit || !target) return;
  unit.orderType = 'move';
  unit.orderTargetId = undefined;
  unit.orderX = target.x;
  unit.orderZ = target.z;
  unit.commandTargetX = target.x;
  unit.commandTargetZ = target.z;
};
const issueAttackMoveOrder = (unit, target) => {
  if (!unit || !target) return;
  unit.orderType = 'attack_move';
  unit.orderTargetId = undefined;
  unit.orderX = target.x;
  unit.orderZ = target.z;
  unit.commandTargetX = target.x;
  unit.commandTargetZ = target.z;
};
const issueAttackOrder = (unit, targetEntity, formation = null) => {
  if (!unit || !targetEntity) return;
  unit.orderType = 'attack';
  unit.orderTargetId = targetEntity.id;
  unit.orderX = targetEntity.x;
  unit.orderZ = targetEntity.z;
  unit.commandTargetX = undefined;
  unit.commandTargetZ = undefined;
  unit.attackFormationAngle = formation?.angle;
  unit.attackFormationRadius = formation?.radius;
  unit.attackFormationRow = formation?.row;
};
const issueRepairOrder = (unit, targetEntity) => {
  if (!unit || !targetEntity) return;
  unit.orderType = 'repair';
  unit.orderTargetId = targetEntity.id;
  unit.orderX = targetEntity.x;
  unit.orderZ = targetEntity.z;
  unit.commandTargetX = undefined;
  unit.commandTargetZ = undefined;
};
const issueGroupAttackOrder = (units, targetEntity) => {
  if (!units?.length || !targetEntity) return;
  const center = units.reduce((acc, unit) => {
    acc.x += unit.x || 0;
    acc.z += unit.z || 0;
    return acc;
  }, { x: 0, z: 0 });
  center.x /= units.length;
  center.z /= units.length;
  const baseAngle = Math.atan2(center.z - targetEntity.z, center.x - targetEntity.x);
  const cols = Math.min(4, units.length);
  units.forEach((unit, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const centeredCol = col - (Math.min(cols, units.length) - 1) / 2;
    const angle = baseAngle + centeredCol * 0.32;
    const baseRadius = unit.type === 'tank' ? 156 : Math.max(unit.idealRange || 130, 112);
    const radius = baseRadius + row * (unit.type === 'tank' ? 22 : 18);
    issueAttackOrder(unit, targetEntity, { angle, radius, row });
  });
  if (typeof window !== 'undefined') {
    window._falloutUnitCommandMarkers = units.map((unit, index) => {
      const cols = Math.min(4, units.length);
      const row = Math.floor(index / cols);
      const col = index % cols;
      const centeredCol = col - (Math.min(cols, units.length) - 1) / 2;
      const angle = baseAngle + centeredCol * 0.32;
      const baseRadius = unit.type === 'tank' ? 156 : Math.max(unit.idealRange || 130, 112);
      const radius = baseRadius + row * (unit.type === 'tank' ? 22 : 18);
      return {
        id: unit.id,
        x: targetEntity.x + Math.cos(angle) * radius,
        z: targetEntity.z + Math.sin(angle) * radius,
        at: Date.now(),
        type: 'attack'
      };
    });
  }
};
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
  kaiju.rotation = kaiju.rotation ?? 0;
  kaiju.deathYaw = kaiju.deathYaw ?? kaiju.rotation;
  kaiju.deathTiltX = kaiju.deathTiltX ?? 0.24;
  kaiju.deathRollZ = kaiju.deathRollZ ?? (
    kaiju.variant === 'octopus' ? Math.PI / 2.5 :
    kaiju.variant === 'spider' ? Math.PI / 3.2 :
    kaiju.variant === 'spicie_bird' ? Math.PI / 3 :
    Math.PI / 2.9
  );
  kaiju.attackPoseUntil = 0;
  kaiju.smashPoseUntil = 0;
  kaiju.specialChargeStartedAt = 0;
  kaiju.specialReleaseAt = 0;
  kaiju.specialPulseUntil = 0;
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
  entity.splashRadius = loadout.splashRadius || 0;
  entity.projectileType = loadout.projectileType || 'bullet';
  entity.fireRate = loadout.fireRate;
  entity.combatSpeed = loadout.moveSpeed;
  entity.hp = loadout.hp;
  entity.maxHp = loadout.hp;
  entity.color = loadout.color;
  entity.weaponEquipped = false;
  entity.weaponEquipStartedAt = 0;
  entity.weaponEquipUntil = 0;
  entity.dead = false;
  return entity;
};

const ensureSoldierWeaponEquipped = (entity, now = Date.now()) => {
  if (!entity) return false;
  if (entity.weaponEquipped) return true;

  const equipUntil = entity.weaponEquipUntil || 0;
  if (equipUntil > now) return false;

  if ((entity.weaponEquipStartedAt || 0) > 0 && equipUntil > 0 && equipUntil <= now) {
    entity.weaponEquipped = true;
    return true;
  }

  const equipDuration = SOLDIER_WEAPON_EQUIP_MS[entity.weaponType] || 320;
  entity.weaponEquipStartedAt = now;
  entity.weaponEquipUntil = now + equipDuration;
  return false;
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
    entity.destroyed = true;
    entity.destroyedAt = entity.destroyedAt || Date.now();
    entity.vx = 0;
    entity.vz = 0;
    entity.reloadTimer = Math.max(entity.reloadTimer || 0, 9999);
    clearUnitOrder(entity);
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
  deathYaw: entity.deathYaw ?? entity.rotation ?? 0,
  deathTiltX: entity.deathTiltX ?? 0.18,
  deathRollZ: entity.deathRollZ ?? Math.PI / 2.8,
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
    groundColor: '#65a30d', groundPolluted: '#6b5f44',
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
    groundColor: '#475569', groundPolluted: '#4b5563', // Asphalt / Concrete
    houseColors: ['#94a3b8', '#64748b', '#cbd5e1', '#475569'], roofColors: ['#64748b', '#7b8da4', '#94a3b8'], // Skyscrapers
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
    groundColor: '#78350f', groundPolluted: '#7c4a24', // Mud/Dirt
    houseColors: ['#4d7c0f', '#3f6212', '#14532d'], roofColors: ['#3f6212', '#14532d', '#052e16'], // Barracks
    carColors: ['#14532d', '#166534', '#064e3b'], // Army jeeps / trucks
    personColors: ['#14532d', '#166534', '#3f6212', '#78350f', '#000000'], // Camouflage
    skyColor: '#ea580c', skyPolluted: '#451a03', // Orange/muddy sunset
    sunColor: '#fef3c7',
    houseScale: 1.2, treeScale: 1.2, carSpeed: 5 // Escaping!
  }
];
const ENVIRONMENT_VARIANTS = [
  {
    key: 'ashen_front',
    label: 'Ashen Front',
    terrainBase: '#88735f',
    terrainTint: '#a68c72',
    patchA: '#b79a7d',
    patchB: '#705e4d',
    crack: '#221712',
    debrisA: '#b69a7e',
    debrisB: '#7a6554',
    overlay: '#8a5a34',
    fog: '#8f7157',
    ambient: '#ffe5c7',
    directional: '#ffd2a8',
    accent: '#f97316'
  },
  {
    key: 'toxic_bloom',
    label: 'Toxic Bloom',
    terrainBase: '#5f7d45',
    terrainTint: '#76985a',
    patchA: '#99ba72',
    patchB: '#4b6336',
    crack: '#1a2912',
    debrisA: '#aec27e',
    debrisB: '#718752',
    overlay: '#a3d948',
    fog: '#6d8f4a',
    ambient: '#f0ffe6',
    directional: '#d9f99d',
    accent: '#a3e635'
  },
  {
    key: 'ember_storm',
    label: 'Ember Storm',
    terrainBase: '#8a5845',
    terrainTint: '#b5755f',
    patchA: '#d38e72',
    patchB: '#734638',
    crack: '#27160f',
    debrisA: '#d08b6a',
    debrisB: '#8b5944',
    overlay: '#f59e61',
    fog: '#a46442',
    ambient: '#ffe7d1',
    directional: '#fdba74',
    accent: '#fb7185'
  },
  {
    key: 'dead_zone',
    label: 'Dead Zone',
    terrainBase: '#788291',
    terrainTint: '#97a2b1',
    patchA: '#b8c3d0',
    patchB: '#616b78',
    crack: '#171d24',
    debrisA: '#c2cad6',
    debrisB: '#737d8b',
    overlay: '#b5c0cf',
    fog: '#7a8696',
    ambient: '#e2e8f0',
    directional: '#cbd5e1',
    accent: '#93c5fd'
  }
];

const pickRandomEnvironmentVariant = (previousKey = null) => {
  const pool = ENVIRONMENT_VARIANTS.filter((variant) => variant.key !== previousKey);
  const source = pool.length ? pool : ENVIRONMENT_VARIANTS;
  return source[Math.floor(Math.random() * source.length)] || ENVIRONMENT_VARIANTS[0];
};

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
const FPS_CAP_OPTIONS = {
  '30': {
    label: '30 FPS',
    note: 'Default · Coolest · Saves battery',
    frameMs: 1000 / 30
  },
  '60': {
    label: '60 FPS',
    note: 'Smoother (runs hotter)',
    frameMs: 1000 / 60
  },
  unlimited: {
    label: 'Unlimited',
    note: 'Use full monitor refresh',
    frameMs: 0
  }
};
const DEFAULT_FPS_CAP = '30';
const getInitialFpsCap = () => {
  if (typeof window === 'undefined') return DEFAULT_FPS_CAP;
  const saved = window.localStorage.getItem('fallout-fps-cap');
  return saved && FPS_CAP_OPTIONS[saved] ? saved : DEFAULT_FPS_CAP;
};
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
  _MAX_CONCURRENT: 20, // Hard cap on simultaneous sounds
  _activeVoices: [],  // Track active voices with type and end time for eviction
  _noiseCache: {},    // Cache noise buffers to avoid regeneration
  _masterInput: null,
  _masterCtx: null,
  _driveCurveCache: {},
  // Minimum interval (seconds) between plays of the same sound type
  _COOLDOWN_MAP: {
    bomb: 0.3, nuke: 6.5, tank_fire: 0.25, plane_engine: 0.9, plane_flyby: 2.2,
    jet_engine: 0.7, tank_engine: 0.7, gun: 0.12, scream: 0.8, kaiju_roar: 2.5,
    fire_breath: 1.5, missile_launch: 0.5, target_confirm: 0.15,
    target_blocked: 0.2, bomb_whistle: 1.2, kaiju_step: 0.5,
    orbital_lance: 8.0, firestorm: 8.5, kinetic_spear: 5.0, brrt: 4.5,
    build_select: 0.3, build_place: 0.5, build_complete: 1.5, build_destroy: 0.8
  },
  init() {
    if (!this.ctx && typeof window !== 'undefined') {
       try {
         const AudioContext = window.AudioContext || window.webkitAudioContext;
         this.ctx = new AudioContext();
         this.ensureMasterBus(this.ctx);
       } catch(e) {}
    }
    return this.ctx;
  },
  createImpulseResponse(ctx, duration = 2.4, decay = 2.8) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const envelope = Math.pow(1 - t, decay);
        const early = i < length * 0.12 ? 1.0 : 0.55;
        data[i] = (Math.random() * 2 - 1) * envelope * early;
      }
    }
    return impulse;
  },
  getDriveCurve(amount = 24) {
    const key = String(Math.round(amount));
    if (this._driveCurveCache[key]) return this._driveCurveCache[key];
    const samples = 1024;
    const curve = new Float32Array(samples);
    const drive = Math.max(1, amount);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(x * drive * 0.08);
    }
    this._driveCurveCache[key] = curve;
    return curve;
  },
  getSoundProfile(type, options = {}) {
    const isUi = type === 'target_confirm' || type === 'target_blocked';
    const isExplosion = type === 'bomb' || type === 'nuke' || type === 'tank_fire' || type === 'missile_launch' || type === 'orbital_lance' || type === 'firestorm' || type === 'kinetic_spear';
    const isEngine = type === 'plane_engine' || type === 'plane_flyby' || type === 'jet_engine' || type === 'tank_engine';
    const isCreature = type === 'scream' || type === 'kaiju_roar' || type === 'kaiju_step' || type === 'fire_breath';
    const isWeapon = type === 'gun' || type === 'bomb_whistle' || type === 'brrt';
    const isBuilding = type === 'build_select' || type === 'build_place' || type === 'build_complete' || type === 'build_destroy';

    if (isUi) return { highpass: 120, lowpass: 3200, drive: 10, trim: 0.86, pan: 0.04 };
    if (isExplosion) return { highpass: 18, lowpass: 5800, drive: 36, trim: 0.98, pan: 0.08 };
    if (isEngine) return { highpass: 32, lowpass: 3600, drive: 22, trim: 0.92, pan: 0.12 };
    if (isCreature) return { highpass: 26, lowpass: 3000, drive: 28, trim: 0.95, pan: 0.08 };
    if (isWeapon) return { highpass: 40, lowpass: 4800, drive: 20, trim: 0.9, pan: 0.1 };
    if (isBuilding) return { highpass: 35, lowpass: 4400, drive: 18, trim: 0.9, pan: 0.06 };
    return {
      highpass: options.highpass || 28,
      lowpass: options.lowpass || 5200,
      drive: options.drive || 16,
      trim: options.trim || 0.9,
      pan: options.pan || 0.08
    };
  },
  createVoiceBus(ctx, type, options = {}) {
    const master = this.ensureMasterBus(ctx) || ctx.destination;
    const profile = this.getSoundProfile(type, options);
    const input = ctx.createGain();
    const highpass = ctx.createBiquadFilter();
    const lowpass = ctx.createBiquadFilter();
    const shaper = ctx.createWaveShaper();
    const compressor = ctx.createDynamicsCompressor();
    const output = ctx.createGain();
    const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;

    input.gain.value = 1;
    highpass.type = 'highpass';
    highpass.frequency.value = profile.highpass;
    lowpass.type = 'lowpass';
    lowpass.frequency.value = profile.lowpass;
    shaper.curve = this.getDriveCurve(profile.drive);
    shaper.oversample = '4x';
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 2.4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.14;
    output.gain.value = profile.trim;

    if (panner) {
      panner.pan.value = (Math.random() - 0.5) * profile.pan * 2;
    }

    input.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(shaper);
    shaper.connect(compressor);
    compressor.connect(output);
    if (panner) {
      output.connect(panner);
      panner.connect(master);
    } else {
      output.connect(master);
    }

    return input;
  },
  ensureMasterBus(ctx) {
    if (this._masterInput && this._masterCtx === ctx) return this._masterInput;

    const input = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const convolver = ctx.createConvolver();
    const highpass = ctx.createBiquadFilter();
    const lowpass = ctx.createBiquadFilter();
    const compressor = ctx.createDynamicsCompressor();
    const limiter = ctx.createGain();

    convolver.buffer = this.createImpulseResponse(ctx, 2.6, 3.0);

    highpass.type = 'highpass';
    highpass.frequency.value = 22;
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 6200;

    dry.gain.value = 0.92;
    wet.gain.value = 0.18;

    compressor.threshold.value = -26;
    compressor.knee.value = 18;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.22;

    limiter.gain.value = 0.92;

    input.connect(dry);
    input.connect(convolver);
    convolver.connect(wet);
    dry.connect(highpass);
    wet.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(ctx.destination);

    this._masterInput = input;
    this._masterCtx = ctx;
    return input;
  },
  // Cleanup when game ends
  cleanup() {
    if (this.ctx) {
      try { this.ctx.close(); } catch(e) {}
      this.ctx = null;
    }
    this._cooldowns = {};
    this._activeCount = 0;
    this._activeVoices = [];
    this._noiseCache = {};
    this._masterInput = null;
    this._masterCtx = null;
    this._driveCurveCache = {};
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
  getBrownNoise(ctx, duration) {
    const key = `brown_${Math.round(duration * 10)}`;
    if (!this._noiseCache[key]) {
      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
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
    
    // Priority types that should never be silenced
    const PRIORITY_TYPES = { gun: true, tank_fire: true, missile_launch: true, bomb: true, nuke: true, orbital_lance: true, firestorm: true, kinetic_spear: true };
    const isPriority = !!PRIORITY_TYPES[type];
    const AMBIENT_TYPES = { tank_engine: true, plane_engine: true, jet_engine: true, kaiju_step: true };
    
    // --- Global concurrent limit with priority eviction ---
    // Clean up expired voices first
    this._activeVoices = (this._activeVoices || []).filter(v => v.endTime > t);
    this._activeCount = this._activeVoices.length;
    
    if (this._activeCount >= this._MAX_CONCURRENT) {
      if (isPriority) {
        // Try to evict lowest-priority ambient voice
        const ambientIdx = this._activeVoices.findIndex(v => AMBIENT_TYPES[v.type]);
        if (ambientIdx !== -1) {
          this._activeVoices.splice(ambientIdx, 1);
          this._activeCount = this._activeVoices.length;
        } else {
          return; // All slots are priority, can't evict
        }
      } else {
        return; // Non-priority sound, skip
      }
    }
    
    this._cooldowns[type] = now;
    // Create voice bus AFTER guards pass (avoids leaked audio nodes)
    const destination = this.createVoiceBus(ctx, type, options);
    this._activeCount++;
    
    // Helper: register voice and auto-release after duration
    const scheduleRelease = (dur) => {
      const voice = { type, endTime: t + dur };
      this._activeVoices.push(voice);
    };
    
    if (type === 'bomb') {
      // ── Realistic explosive concussion ──
      // Layer 1: deep pressure wave — brown noise through steep lowpass
      const dur = 1.4;
      const pressure = ctx.createBufferSource();
      pressure.buffer = this.getBrownNoise(ctx, dur);
      const pressLP = ctx.createBiquadFilter();
      pressLP.type = 'lowpass';
      pressLP.frequency.setValueAtTime(180, t);
      pressLP.frequency.exponentialRampToValueAtTime(28, t + dur * 0.7);
      const pressGain = ctx.createGain();
      pressGain.gain.setValueAtTime(0.52, t);
      pressGain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      pressure.connect(pressLP).connect(pressGain).connect(destination);
      pressure.start(t); pressure.stop(t + dur);
      // Layer 2: initial crack — white noise burst, highpass to remove mud
      const snap = ctx.createBufferSource();
      snap.buffer = this.getNoiseBuffer(ctx, 0.06);
      const snapHP = ctx.createBiquadFilter();
      snapHP.type = 'highpass'; snapHP.frequency.value = 2200;
      const snapGain = ctx.createGain();
      snapGain.gain.setValueAtTime(0.18, t);
      snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      snap.connect(snapHP).connect(snapGain).connect(destination);
      snap.start(t); snap.stop(t + 0.06);
      // Layer 3: debris scatter — pink noise shaped into mid-band crackle
      const debris = ctx.createBufferSource();
      debris.buffer = this.getPinkNoise(ctx, 0.6);
      const debrisBP = ctx.createBiquadFilter();
      debrisBP.type = 'bandpass'; debrisBP.frequency.setValueAtTime(640, t);
      debrisBP.frequency.exponentialRampToValueAtTime(120, t + 0.6); debrisBP.Q.value = 0.5;
      const debrisGain = ctx.createGain();
      debrisGain.gain.setValueAtTime(0.16, t + 0.02);
      debrisGain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      debris.connect(debrisBP).connect(debrisGain).connect(destination);
      debris.start(t + 0.01); debris.stop(t + 0.6);
      // Layer 4: sub thump — sine only, no audible pitch
      const sub = ctx.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(42, t); sub.frequency.exponentialRampToValueAtTime(18, t + 0.4);
      const subG = ctx.createGain();
      subG.gain.setValueAtTime(0.38, t); subG.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      sub.connect(subG).connect(destination); sub.start(t); sub.stop(t + 0.4);
      scheduleRelease(dur);

    } else if (type === 'nuke') {
      // ══════════════════════════════════════════════════════════════
      // NUCLEAR DETONATION — cinematic 10-layer, 6-second soundscape
      // Phase 1: Flash/EMP  Phase 2: Shockwave  Phase 3: Fireball
      // Phase 4: Mushroom   Phase 5: Aftermath  Phase 6: Decay
      // ══════════════════════════════════════════════════════════════
      const dur = 6.0;

      // ── Layer 1: EMP flash — instant full-spectrum white noise spike ──
      // The blinding flash arrives at speed of light — a sharp crack
      const emp = ctx.createBufferSource();
      emp.buffer = this.getNoiseBuffer(ctx, 0.06);
      const empHP = ctx.createBiquadFilter();
      empHP.type = 'highpass'; empHP.frequency.value = 4000;
      const empG = ctx.createGain();
      empG.gain.setValueAtTime(0.35, t);
      empG.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      emp.connect(empHP).connect(empG).connect(destination);
      emp.start(t); emp.stop(t + 0.06);

      // ── Layer 2: Shockwave crack — broadband concussion burst ──
      // The wall of compressed air arrives ~0.02s after flash
      const crack = ctx.createBufferSource();
      crack.buffer = this.getNoiseBuffer(ctx, 0.12);
      const crackBP = ctx.createBiquadFilter();
      crackBP.type = 'bandpass'; crackBP.frequency.value = 1200; crackBP.Q.value = 0.3;
      const crackG = ctx.createGain();
      crackG.gain.setValueAtTime(0.001, t);
      crackG.gain.linearRampToValueAtTime(0.42, t + 0.015);
      crackG.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      crack.connect(crackBP).connect(crackG).connect(destination);
      crack.start(t + 0.02); crack.stop(t + 0.14);

      // ── Layer 3: Dual sub-bass pressure dome — two sine oscillators ──
      // Fundamental sub (22Hz→6Hz) + harmonic (44Hz→12Hz) for chest-punch
      const sub1 = ctx.createOscillator(); sub1.type = 'sine';
      sub1.frequency.setValueAtTime(22, t);
      sub1.frequency.exponentialRampToValueAtTime(6, t + dur);
      const sub1G = ctx.createGain();
      sub1G.gain.setValueAtTime(0.001, t);
      sub1G.gain.linearRampToValueAtTime(0.52, t + 0.04);
      sub1G.gain.setValueAtTime(0.52, t + 0.5);
      sub1G.gain.exponentialRampToValueAtTime(0.001, t + dur);
      sub1.connect(sub1G).connect(destination);
      sub1.start(t); sub1.stop(t + dur);

      const sub2 = ctx.createOscillator(); sub2.type = 'sine';
      sub2.frequency.setValueAtTime(44, t);
      sub2.frequency.exponentialRampToValueAtTime(12, t + dur * 0.7);
      const sub2G = ctx.createGain();
      sub2G.gain.setValueAtTime(0.001, t);
      sub2G.gain.linearRampToValueAtTime(0.28, t + 0.04);
      sub2G.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.7);
      sub2.connect(sub2G).connect(destination);
      sub2.start(t); sub2.stop(t + dur * 0.7);

      // ── Layer 4: Shockwave body — heavy brown noise wall ──
      // The massive air-displacement pressure wall
      const body = ctx.createBufferSource();
      body.buffer = this.getBrownNoise(ctx, dur * 0.7);
      const bodyLP = ctx.createBiquadFilter();
      bodyLP.type = 'lowpass';
      bodyLP.frequency.setValueAtTime(520, t);
      bodyLP.frequency.exponentialRampToValueAtTime(25, t + dur * 0.65);
      const bodyG = ctx.createGain();
      bodyG.gain.setValueAtTime(0.001, t);
      bodyG.gain.linearRampToValueAtTime(0.52, t + 0.03);
      bodyG.gain.setValueAtTime(0.48, t + 0.4);
      bodyG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.7);
      body.connect(bodyLP).connect(bodyG).connect(destination);
      body.start(t); body.stop(t + dur * 0.7);

      // ── Layer 5: Fireball roar — pink noise swell for the billowing inferno ──
      // Rises after the shockwave as the fireball expands upward
      const roar = ctx.createBufferSource();
      roar.buffer = this.getPinkNoise(ctx, dur);
      const roarBP = ctx.createBiquadFilter();
      roarBP.type = 'bandpass';
      roarBP.frequency.setValueAtTime(120, t);
      roarBP.frequency.linearRampToValueAtTime(340, t + 0.8);
      roarBP.frequency.exponentialRampToValueAtTime(50, t + dur);
      roarBP.Q.value = 0.35;
      const roarG = ctx.createGain();
      roarG.gain.setValueAtTime(0.001, t);
      roarG.gain.linearRampToValueAtTime(0.36, t + 0.5);
      roarG.gain.setValueAtTime(0.32, t + 1.5);
      roarG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      roar.connect(roarBP).connect(roarG).connect(destination);
      roar.start(t + 0.08); roar.stop(t + dur);

      // ── Layer 6: Air suction / vacuum collapse ──
      // After shockwave passes, air rushes BACK toward the blast center
      const suction = ctx.createBufferSource();
      suction.buffer = this.getPinkNoise(ctx, 1.8);
      const suctionHP = ctx.createBiquadFilter();
      suctionHP.type = 'highpass';
      suctionHP.frequency.setValueAtTime(180, t + 0.6);
      suctionHP.frequency.linearRampToValueAtTime(800, t + 1.6);
      suctionHP.frequency.linearRampToValueAtTime(100, t + 2.4);
      const suctionG = ctx.createGain();
      suctionG.gain.setValueAtTime(0.001, t);
      suctionG.gain.linearRampToValueAtTime(0.18, t + 1.2);
      suctionG.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
      suction.connect(suctionHP).connect(suctionG).connect(destination);
      suction.start(t + 0.6); suction.stop(t + 2.4);

      // ── Layer 7: Mushroom cloud churn — modulated deep rumble ──
      // Low churning rumble as the mushroom cap billows and rolls
      const churn = ctx.createBufferSource();
      churn.buffer = this.getBrownNoise(ctx, dur * 0.75);
      const churnLP = ctx.createBiquadFilter();
      churnLP.type = 'lowpass';
      churnLP.frequency.setValueAtTime(200, t + 1.0);
      churnLP.frequency.linearRampToValueAtTime(280, t + 2.5);
      churnLP.frequency.exponentialRampToValueAtTime(40, t + dur * 0.75);
      const churnG = ctx.createGain();
      churnG.gain.setValueAtTime(0.001, t);
      churnG.gain.linearRampToValueAtTime(0.22, t + 1.5);
      churnG.gain.setValueAtTime(0.2, t + 2.5);
      churnG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.75);
      churn.connect(churnLP).connect(churnG).connect(destination);
      churn.start(t + 0.8); churn.stop(t + dur * 0.75);

      // ── Layer 8: Secondary detonations — staggered crackle bursts ──
      // Fuel tanks, ammo dumps, gas lines igniting in the blast zone
      const sec = ctx.createBufferSource();
      sec.buffer = this.getNoiseBuffer(ctx, 2.5);
      const secBP = ctx.createBiquadFilter();
      secBP.type = 'bandpass';
      secBP.frequency.setValueAtTime(600, t + 1.2);
      secBP.frequency.linearRampToValueAtTime(1400, t + 2.0);
      secBP.frequency.exponentialRampToValueAtTime(200, t + 3.7);
      secBP.Q.value = 0.8;
      const secG = ctx.createGain();
      secG.gain.setValueAtTime(0.001, t);
      secG.gain.linearRampToValueAtTime(0.12, t + 1.5);
      secG.gain.linearRampToValueAtTime(0.14, t + 2.2);
      secG.gain.exponentialRampToValueAtTime(0.001, t + 3.7);
      sec.connect(secBP).connect(secG).connect(destination);
      sec.start(t + 1.2); sec.stop(t + 3.7);

      // ── Layer 9: Ground tremor — very low frequency earth shake ──
      // The ground itself shakes — sub-audible rumble felt in the body
      const tremor = ctx.createOscillator(); tremor.type = 'sine';
      tremor.frequency.setValueAtTime(10, t);
      tremor.frequency.linearRampToValueAtTime(16, t + 1.0);
      tremor.frequency.exponentialRampToValueAtTime(4, t + dur * 0.7);
      const tremorG = ctx.createGain();
      tremorG.gain.setValueAtTime(0.001, t);
      tremorG.gain.linearRampToValueAtTime(0.18, t + 0.3);
      tremorG.gain.setValueAtTime(0.16, t + 1.0);
      tremorG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.7);
      tremor.connect(tremorG).connect(destination);
      tremor.start(t + 0.05); tremor.stop(t + dur * 0.7);

      // ── Layer 10: Debris rain + distant thunder echo ──
      // Debris falling from the sky + reflected shockwave off terrain
      const rain = ctx.createBufferSource();
      rain.buffer = this.getNoiseBuffer(ctx, dur * 0.6);
      const rainBP = ctx.createBiquadFilter();
      rainBP.type = 'bandpass';
      rainBP.frequency.setValueAtTime(1800, t + 2.0);
      rainBP.frequency.exponentialRampToValueAtTime(250, t + dur);
      rainBP.Q.value = 0.6;
      const rainG = ctx.createGain();
      rainG.gain.setValueAtTime(0.001, t);
      rainG.gain.linearRampToValueAtTime(0.09, t + 2.5);
      rainG.gain.setValueAtTime(0.08, t + 3.5);
      rainG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      rain.connect(rainBP).connect(rainG).connect(destination);
      rain.start(t + 1.8); rain.stop(t + dur);

      // Distant thunder — delayed brown noise pulse (reflected shockwave)
      const thunder = ctx.createBufferSource();
      thunder.buffer = this.getBrownNoise(ctx, 2.0);
      const thunderLP = ctx.createBiquadFilter();
      thunderLP.type = 'lowpass';
      thunderLP.frequency.setValueAtTime(300, t + 3.0);
      thunderLP.frequency.exponentialRampToValueAtTime(50, t + 5.5);
      const thunderG = ctx.createGain();
      thunderG.gain.setValueAtTime(0.001, t);
      thunderG.gain.linearRampToValueAtTime(0.14, t + 3.4);
      thunderG.gain.exponentialRampToValueAtTime(0.001, t + 5.5);
      thunder.connect(thunderLP).connect(thunderG).connect(destination);
      thunder.start(t + 3.0); thunder.stop(t + 5.5);

      scheduleRelease(dur);

    } else if (type === 'orbital_lance') {
      // ══════════════════════════════════════════════════════════════
      // ORBITAL LANCE — precision ion beam from orbit, 5-layer, 4s
      // Phase 1: EMP crack  Phase 2: Beam hum  Phase 3: Discharge
      // ══════════════════════════════════════════════════════════════
      const dur = 4.0;
      const vol = options.volume || 1.0;
      // Layer 1: EMP crack — white noise burst, steeply highpassed
      const crack = ctx.createBufferSource();
      crack.buffer = this.getNoiseBuffer(ctx, 0.08);
      const crackHP = ctx.createBiquadFilter();
      crackHP.type = 'highpass'; crackHP.frequency.value = 3200;
      const crackG = ctx.createGain();
      crackG.gain.setValueAtTime(vol * 0.36, t);
      crackG.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      crack.connect(crackHP).connect(crackG).connect(destination);
      crack.start(t); crack.stop(t + 0.08);
      // Layer 2: Ion beam hum — sine swept 880→110→44Hz
      const hum = ctx.createOscillator(); hum.type = 'sine';
      hum.frequency.setValueAtTime(880, t);
      hum.frequency.exponentialRampToValueAtTime(110, t + 0.55);
      hum.frequency.exponentialRampToValueAtTime(44, t + dur * 0.55);
      const humG = ctx.createGain();
      humG.gain.setValueAtTime(0.001, t);
      humG.gain.linearRampToValueAtTime(vol * 0.40, t + 0.1);
      humG.gain.setValueAtTime(vol * 0.34, t + 0.4);
      humG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.55);
      hum.connect(humG).connect(destination);
      hum.start(t); hum.stop(t + dur * 0.55);
      // Layer 3: Electric discharge crackle — pink noise, mid-high bandpass
      const discharge = ctx.createBufferSource();
      discharge.buffer = this.getPinkNoise(ctx, 1.8);
      const dischargeBP = ctx.createBiquadFilter();
      dischargeBP.type = 'bandpass';
      dischargeBP.frequency.setValueAtTime(1800, t + 0.06);
      dischargeBP.frequency.exponentialRampToValueAtTime(380, t + 1.8);
      dischargeBP.Q.value = 0.6;
      const dischargeG = ctx.createGain();
      dischargeG.gain.setValueAtTime(0.001, t);
      dischargeG.gain.linearRampToValueAtTime(vol * 0.26, t + 0.1);
      dischargeG.gain.setValueAtTime(vol * 0.22, t + 0.5);
      dischargeG.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
      discharge.connect(dischargeBP).connect(dischargeG).connect(destination);
      discharge.start(t + 0.06); discharge.stop(t + 1.8);
      // Layer 4: Deep impact thud — brown noise, sub-bass concussion
      const thud = ctx.createBufferSource();
      thud.buffer = this.getBrownNoise(ctx, 1.2);
      const thudLP = ctx.createBiquadFilter();
      thudLP.type = 'lowpass';
      thudLP.frequency.setValueAtTime(240, t);
      thudLP.frequency.exponentialRampToValueAtTime(28, t + 1.0);
      const thudG = ctx.createGain();
      thudG.gain.setValueAtTime(0.001, t);
      thudG.gain.linearRampToValueAtTime(vol * 0.50, t + 0.04);
      thudG.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
      thud.connect(thudLP).connect(thudG).connect(destination);
      thud.start(t); thud.stop(t + 1.2);
      // Layer 5: Resonant aftermath — low-frequency sustain
      const res = ctx.createOscillator(); res.type = 'sine';
      res.frequency.setValueAtTime(55, t + 0.3);
      res.frequency.exponentialRampToValueAtTime(20, t + dur);
      const resG = ctx.createGain();
      resG.gain.setValueAtTime(0.001, t);
      resG.gain.linearRampToValueAtTime(vol * 0.16, t + 0.5);
      resG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      res.connect(resG).connect(destination);
      res.start(t + 0.3); res.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'firestorm') {
      // ══════════════════════════════════════════════════════════════
      // FIRESTORM — napalm carpet ignition, 5-layer, 5.5-second
      // Phase 1: Ignition  Phase 2: Fire rush  Phase 3: Rolling burn
      // ══════════════════════════════════════════════════════════════
      const dur = 5.5;
      const vol = options.volume || 1.0;
      // Layer 1: Multi-burst ignition — staggered white-noise pops
      for (let i = 0; i < 4; i++) {
        const burst = ctx.createBufferSource();
        burst.buffer = this.getNoiseBuffer(ctx, 0.06 + i * 0.02);
        const burstBP = ctx.createBiquadFilter();
        burstBP.type = 'bandpass'; burstBP.frequency.value = 1200 + i * 400; burstBP.Q.value = 0.8;
        const burstG = ctx.createGain();
        burstG.gain.setValueAtTime(vol * (0.26 - i * 0.04), t + i * 0.08);
        burstG.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.1);
        burst.connect(burstBP).connect(burstG).connect(destination);
        burst.start(t + i * 0.08); burst.stop(t + i * 0.08 + 0.12);
      }
      // Layer 2: Fire rush — pink noise whoosh (combustion air displacement)
      const rush = ctx.createBufferSource();
      rush.buffer = this.getPinkNoise(ctx, 2.4);
      const rushLP = ctx.createBiquadFilter();
      rushLP.type = 'lowpass';
      rushLP.frequency.setValueAtTime(180, t);
      rushLP.frequency.linearRampToValueAtTime(1800, t + 0.4);
      rushLP.frequency.exponentialRampToValueAtTime(240, t + 2.4);
      const rushG = ctx.createGain();
      rushG.gain.setValueAtTime(0.001, t);
      rushG.gain.linearRampToValueAtTime(vol * 0.46, t + 0.28);
      rushG.gain.setValueAtTime(vol * 0.38, t + 0.9);
      rushG.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
      rush.connect(rushLP).connect(rushG).connect(destination);
      rush.start(t + 0.1); rush.stop(t + 2.4);
      // Layer 3: Sub-bass pressure — brown noise concussive wave
      const pressure = ctx.createBufferSource();
      pressure.buffer = this.getBrownNoise(ctx, 1.4);
      const pressLP2 = ctx.createBiquadFilter();
      pressLP2.type = 'lowpass';
      pressLP2.frequency.setValueAtTime(360, t);
      pressLP2.frequency.exponentialRampToValueAtTime(26, t + 1.2);
      const pressG2 = ctx.createGain();
      pressG2.gain.setValueAtTime(0.001, t);
      pressG2.gain.linearRampToValueAtTime(vol * 0.56, t + 0.05);
      pressG2.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      pressure.connect(pressLP2).connect(pressG2).connect(destination);
      pressure.start(t); pressure.stop(t + 1.4);
      // Layer 4: Rolling burn — pink noise sustained flame roar
      const burn = ctx.createBufferSource();
      burn.buffer = this.getPinkNoise(ctx, dur);
      const burnBP = ctx.createBiquadFilter();
      burnBP.type = 'bandpass';
      burnBP.frequency.setValueAtTime(80, t + 0.4);
      burnBP.frequency.linearRampToValueAtTime(260, t + 1.5);
      burnBP.frequency.exponentialRampToValueAtTime(55, t + dur);
      burnBP.Q.value = 0.4;
      const burnG = ctx.createGain();
      burnG.gain.setValueAtTime(0.001, t);
      burnG.gain.linearRampToValueAtTime(vol * 0.32, t + 1.0);
      burnG.gain.setValueAtTime(vol * 0.28, t + 2.2);
      burnG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      burn.connect(burnBP).connect(burnG).connect(destination);
      burn.start(t + 0.4); burn.stop(t + dur);
      // Layer 5: Heat-wind sub tone — infrasonic sine
      const heatTone = ctx.createOscillator(); heatTone.type = 'sine';
      heatTone.frequency.setValueAtTime(32, t + 0.2);
      heatTone.frequency.linearRampToValueAtTime(16, t + dur * 0.8);
      const heatG = ctx.createGain();
      heatG.gain.setValueAtTime(0.001, t);
      heatG.gain.linearRampToValueAtTime(vol * 0.22, t + 0.6);
      heatG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.8);
      heatTone.connect(heatG).connect(destination);
      heatTone.start(t + 0.2); heatTone.stop(t + dur * 0.8);
      scheduleRelease(dur);

    } else if (type === 'kinetic_spear') {
      // ══════════════════════════════════════════════════════════════
      // KINETIC SPEAR — hypersonic tungsten rod impact, 5-layer, 3.5s
      // Phase 1: Sonic boom  Phase 2: Seismic thud  Phase 3: Metal ring
      // ══════════════════════════════════════════════════════════════
      const dur = 3.5;
      const vol = options.volume || 1.0;
      // Layer 1: Supersonic crack — ultra-brief white noise spike (sonic boom)
      const sonic = ctx.createBufferSource();
      sonic.buffer = this.getNoiseBuffer(ctx, 0.04);
      const sonicHP = ctx.createBiquadFilter();
      sonicHP.type = 'highpass'; sonicHP.frequency.value = 2800;
      const sonicG = ctx.createGain();
      sonicG.gain.setValueAtTime(vol * 0.54, t);
      sonicG.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      sonic.connect(sonicHP).connect(sonicG).connect(destination);
      sonic.start(t); sonic.stop(t + 0.04);
      // Layer 2: Kinetic impact thud — brown noise, extremely low-pass slam
      const thud2 = ctx.createBufferSource();
      thud2.buffer = this.getBrownNoise(ctx, 0.9);
      const thudLP2 = ctx.createBiquadFilter();
      thudLP2.type = 'lowpass';
      thudLP2.frequency.setValueAtTime(280, t);
      thudLP2.frequency.exponentialRampToValueAtTime(16, t + 0.7);
      const thudG2 = ctx.createGain();
      thudG2.gain.setValueAtTime(0.001, t);
      thudG2.gain.linearRampToValueAtTime(vol * 0.68, t + 0.02);
      thudG2.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      thud2.connect(thudLP2).connect(thudG2).connect(destination);
      thud2.start(t); thud2.stop(t + 0.9);
      // Layer 3: Metallic ring — sawtooth through tight bandpass
      const ringOsc = ctx.createOscillator(); ringOsc.type = 'sawtooth';
      ringOsc.frequency.setValueAtTime(220, t + 0.02);
      ringOsc.frequency.exponentialRampToValueAtTime(52, t + dur * 0.7);
      const ringFilter = ctx.createBiquadFilter();
      ringFilter.type = 'bandpass'; ringFilter.frequency.value = 880; ringFilter.Q.value = 4;
      const ringG2 = ctx.createGain();
      ringG2.gain.setValueAtTime(0.001, t);
      ringG2.gain.linearRampToValueAtTime(vol * 0.24, t + 0.05);
      ringG2.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.7);
      ringOsc.connect(ringFilter).connect(ringG2).connect(destination);
      ringOsc.start(t + 0.02); ringOsc.stop(t + dur * 0.7);
      // Layer 4: Seismic sub rumble — deep brown noise aftermath
      const seismic = ctx.createBufferSource();
      seismic.buffer = this.getBrownNoise(ctx, 1.8);
      const seisLP = ctx.createBiquadFilter();
      seisLP.type = 'lowpass';
      seisLP.frequency.setValueAtTime(120, t + 0.05);
      seisLP.frequency.exponentialRampToValueAtTime(20, t + 1.6);
      const seisG = ctx.createGain();
      seisG.gain.setValueAtTime(0.001, t);
      seisG.gain.linearRampToValueAtTime(vol * 0.38, t + 0.08);
      seisG.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
      seismic.connect(seisLP).connect(seisG).connect(destination);
      seismic.start(t + 0.02); seismic.stop(t + 1.8);
      // Layer 5: Debris scatter — white noise tail
      const debris2 = ctx.createBufferSource();
      debris2.buffer = this.getNoiseBuffer(ctx, dur - 0.3);
      const debrBP = ctx.createBiquadFilter();
      debrBP.type = 'bandpass';
      debrBP.frequency.setValueAtTime(1200, t + 0.2);
      debrBP.frequency.exponentialRampToValueAtTime(160, t + dur - 0.3);
      debrBP.Q.value = 0.7;
      const debrG = ctx.createGain();
      debrG.gain.setValueAtTime(0.001, t);
      debrG.gain.linearRampToValueAtTime(vol * 0.14, t + 0.28);
      debrG.gain.exponentialRampToValueAtTime(0.001, t + dur - 0.3);
      debris2.connect(debrBP).connect(debrG).connect(destination);
      debris2.start(t + 0.2); debris2.stop(t + dur - 0.3);
      scheduleRelease(dur);

    } else if (type === 'tank_fire') {
      // ── Cannon shot: concussive pressure + muzzle blast ──
      const dur = options.duration || 0.55;
      const vol = options.volume || 0.22;
      // Muzzle blast — white noise burst, very short
      const muzzle = ctx.createBufferSource();
      muzzle.buffer = this.getNoiseBuffer(ctx, 0.05);
      const muzzleHP = ctx.createBiquadFilter();
      muzzleHP.type = 'highpass'; muzzleHP.frequency.value = 1800;
      const muzzleG = ctx.createGain();
      muzzleG.gain.setValueAtTime(vol * 0.7, t);
      muzzleG.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      muzzle.connect(muzzleHP).connect(muzzleG).connect(destination);
      muzzle.start(t); muzzle.stop(t + 0.05);
      // Pressure body — brown noise lowpassed
      const press = ctx.createBufferSource();
      press.buffer = this.getBrownNoise(ctx, dur);
      const pressLP = ctx.createBiquadFilter();
      pressLP.type = 'lowpass'; pressLP.frequency.setValueAtTime(220, t);
      pressLP.frequency.exponentialRampToValueAtTime(35, t + dur);
      const pressG = ctx.createGain();
      pressG.gain.setValueAtTime(vol * 0.85, t);
      pressG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      press.connect(pressLP).connect(pressG).connect(destination);
      press.start(t); press.stop(t + dur);
      // Concussion ring — sub sine thump
      const thump = ctx.createOscillator(); thump.type = 'sine';
      thump.frequency.setValueAtTime(55, t); thump.frequency.exponentialRampToValueAtTime(22, t + dur * 0.4);
      const thumpG = ctx.createGain();
      thumpG.gain.setValueAtTime(vol * 0.6, t); thumpG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.4);
      thump.connect(thumpG).connect(destination); thump.start(t); thump.stop(t + dur * 0.4);
      // Shell casing rattle — delayed pink noise snippet
      const casing = ctx.createBufferSource();
      casing.buffer = this.getPinkNoise(ctx, 0.12);
      const casingBP = ctx.createBiquadFilter();
      casingBP.type = 'bandpass'; casingBP.frequency.value = 2800; casingBP.Q.value = 1.5;
      const casingG = ctx.createGain();
      casingG.gain.setValueAtTime(vol * 0.08, t + 0.06);
      casingG.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      casing.connect(casingBP).connect(casingG).connect(destination);
      casing.start(t + 0.06); casing.stop(t + 0.18);
      scheduleRelease(dur);

    } else if (type === 'plane_engine') {
      // ── Prop-engine drone: shaped noise only, no oscillator pitch ──
      const dur = options.duration || 0.9;
      const vol = options.volume || 0.08;
      // Core drone — brown noise through tight lowpass (feels like air vibration)
      const drone = ctx.createBufferSource();
      drone.buffer = this.getBrownNoise(ctx, dur);
      const droneLP = ctx.createBiquadFilter();
      droneLP.type = 'lowpass'; droneLP.frequency.setValueAtTime(160 + Math.random() * 30, t);
      droneLP.frequency.linearRampToValueAtTime(100 + Math.random() * 20, t + dur);
      const droneG = ctx.createGain();
      droneG.gain.setValueAtTime(vol * 0.9, t);
      droneG.gain.linearRampToValueAtTime(0.001, t + dur);
      drone.connect(droneLP).connect(droneG).connect(destination);
      drone.start(t); drone.stop(t + dur);
      // Exhaust wash — pink noise bandpass mid-range
      const wash = ctx.createBufferSource();
      wash.buffer = this.getPinkNoise(ctx, dur);
      const washBP = ctx.createBiquadFilter();
      washBP.type = 'bandpass'; washBP.frequency.setValueAtTime(240 + Math.random() * 40, t);
      washBP.frequency.linearRampToValueAtTime(140 + Math.random() * 30, t + dur); washBP.Q.value = 0.4;
      const washG = ctx.createGain();
      washG.gain.setValueAtTime(vol * 0.5, t);
      washG.gain.linearRampToValueAtTime(0.001, t + dur);
      wash.connect(washBP).connect(washG).connect(destination);
      wash.start(t); wash.stop(t + dur);
      // Sub-bass airframe rumble
      const sub = ctx.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(34 + Math.random() * 6, t);
      sub.frequency.linearRampToValueAtTime(28 + Math.random() * 4, t + dur);
      const subG = ctx.createGain();
      subG.gain.setValueAtTime(vol * 0.35, t);
      subG.gain.linearRampToValueAtTime(0.001, t + dur);
      sub.connect(subG).connect(destination); sub.start(t); sub.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'plane_flyby') {
      // ── Doppler flyover: noise volume swell + sub sweep ──
      const dur = options.duration || 1.8;
      const vol = options.volume || 0.12;
      // Main body — brown noise with swell-then-fade envelope
      const body = ctx.createBufferSource();
      body.buffer = this.getBrownNoise(ctx, dur);
      const bodyLP = ctx.createBiquadFilter();
      bodyLP.type = 'lowpass'; bodyLP.frequency.setValueAtTime(260, t);
      bodyLP.frequency.linearRampToValueAtTime(380, t + dur * 0.3);
      bodyLP.frequency.linearRampToValueAtTime(90, t + dur);
      const bodyG = ctx.createGain();
      bodyG.gain.setValueAtTime(vol * 0.15, t);
      bodyG.gain.linearRampToValueAtTime(vol, t + dur * 0.25);
      bodyG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      body.connect(bodyLP).connect(bodyG).connect(destination);
      body.start(t); body.stop(t + dur);
      // Wind shear — white noise highpass
      const wind = ctx.createBufferSource();
      wind.buffer = this.getNoiseBuffer(ctx, dur);
      const windHP = ctx.createBiquadFilter();
      windHP.type = 'highpass'; windHP.frequency.setValueAtTime(1200, t);
      windHP.frequency.linearRampToValueAtTime(600, t + dur);
      const windG = ctx.createGain();
      windG.gain.setValueAtTime(0.001, t);
      windG.gain.linearRampToValueAtTime(vol * 0.14, t + dur * 0.2);
      windG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      wind.connect(windHP).connect(windG).connect(destination);
      wind.start(t); wind.stop(t + dur);
      // Sub pressure
      const sub = ctx.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(38, t); sub.frequency.linearRampToValueAtTime(22, t + dur);
      const subG = ctx.createGain();
      subG.gain.setValueAtTime(vol * 0.3, t);
      subG.gain.linearRampToValueAtTime(0.001, t + dur);
      sub.connect(subG).connect(destination); sub.start(t); sub.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'tank_engine') {
      // ── Diesel idle: all noise, no pitched oscillators ──
      const dur = options.duration || 0.4;
      const vol = options.volume || 0.035;
      // Diesel chug — brown noise lowpassed to ~100Hz
      const chug = ctx.createBufferSource();
      chug.buffer = this.getBrownNoise(ctx, dur);
      const chugLP = ctx.createBiquadFilter();
      chugLP.type = 'lowpass'; chugLP.frequency.setValueAtTime(95, t);
      chugLP.frequency.linearRampToValueAtTime(70, t + dur);
      const chugG = ctx.createGain();
      chugG.gain.setValueAtTime(vol * 0.9, t);
      chugG.gain.linearRampToValueAtTime(0.001, t + dur);
      chug.connect(chugLP).connect(chugG).connect(destination);
      chug.start(t); chug.stop(t + dur);
      // Track clatter — white noise bandpass
      const clatter = ctx.createBufferSource();
      clatter.buffer = this.getNoiseBuffer(ctx, dur);
      const clatterBP = ctx.createBiquadFilter();
      clatterBP.type = 'bandpass'; clatterBP.frequency.setValueAtTime(420, t);
      clatterBP.frequency.linearRampToValueAtTime(260, t + dur); clatterBP.Q.value = 1.4;
      const clatterG = ctx.createGain();
      clatterG.gain.setValueAtTime(vol * 0.3, t);
      clatterG.gain.linearRampToValueAtTime(0.001, t + dur);
      clatter.connect(clatterBP).connect(clatterG).connect(destination);
      clatter.start(t); clatter.stop(t + dur);
      // Exhaust puff — pink noise short burst
      const puff = ctx.createBufferSource();
      puff.buffer = this.getPinkNoise(ctx, dur * 0.5);
      const puffLP = ctx.createBiquadFilter();
      puffLP.type = 'lowpass'; puffLP.frequency.value = 200;
      const puffG = ctx.createGain();
      puffG.gain.setValueAtTime(vol * 0.25, t);
      puffG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.5);
      puff.connect(puffLP).connect(puffG).connect(destination);
      puff.start(t); puff.stop(t + dur * 0.5);
      scheduleRelease(dur);

    } else if (type === 'jet_engine') {
      // ── Jet turbine: shaped noise roar, no tonal oscillators ──
      const dur = options.duration || 0.5;
      const vol = options.volume || 0.09;
      // Turbine core — pink noise through sweeping bandpass
      const core = ctx.createBufferSource();
      core.buffer = this.getPinkNoise(ctx, dur);
      const coreBP = ctx.createBiquadFilter();
      coreBP.type = 'bandpass'; coreBP.frequency.setValueAtTime(280, t);
      coreBP.frequency.linearRampToValueAtTime(460, t + dur * 0.3);
      coreBP.frequency.linearRampToValueAtTime(200, t + dur); coreBP.Q.value = 0.5;
      const coreG = ctx.createGain();
      coreG.gain.setValueAtTime(vol * 0.7, t);
      coreG.gain.linearRampToValueAtTime(0.001, t + dur);
      core.connect(coreBP).connect(coreG).connect(destination);
      core.start(t); core.stop(t + dur);
      // Hot exhaust — brown noise low rumble
      const exhaust = ctx.createBufferSource();
      exhaust.buffer = this.getBrownNoise(ctx, dur);
      const exhaustLP = ctx.createBiquadFilter();
      exhaustLP.type = 'lowpass'; exhaustLP.frequency.setValueAtTime(140, t);
      exhaustLP.frequency.linearRampToValueAtTime(60, t + dur);
      const exhaustG = ctx.createGain();
      exhaustG.gain.setValueAtTime(vol * 0.55, t);
      exhaustG.gain.linearRampToValueAtTime(0.001, t + dur);
      exhaust.connect(exhaustLP).connect(exhaustG).connect(destination);
      exhaust.start(t); exhaust.stop(t + dur);
      // High-freq air shriek — white noise highpassed
      const shriek = ctx.createBufferSource();
      shriek.buffer = this.getNoiseBuffer(ctx, dur);
      const shriekHP = ctx.createBiquadFilter();
      shriekHP.type = 'highpass'; shriekHP.frequency.setValueAtTime(2400, t);
      shriekHP.frequency.linearRampToValueAtTime(1200, t + dur);
      const shriekG = ctx.createGain();
      shriekG.gain.setValueAtTime(vol * 0.12, t);
      shriekG.gain.linearRampToValueAtTime(0.001, t + dur);
      shriek.connect(shriekHP).connect(shriekG).connect(destination);
      shriek.start(t); shriek.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'gun') {
      // ── Gunfire: shaped noise transients, no pitched square/saw ──
      const profile = options.profile || 'rifleman';
      const vol = options.volume || (profile === 'gunner' ? 0.15 : profile === 'marksman' ? 0.18 : 0.16);
      const dur = profile === 'gunner' ? 0.16 : profile === 'marksman' ? 0.24 : 0.18;
      // Supersonic crack — white noise spike
      const crack = ctx.createBufferSource();
      crack.buffer = this.getNoiseBuffer(ctx, 0.03);
      const crackHP = ctx.createBiquadFilter();
      crackHP.type = 'highpass';
      crackHP.frequency.value = profile === 'marksman' ? 3200 : profile === 'gunner' ? 1800 : 2400;
      const crackG = ctx.createGain();
      crackG.gain.setValueAtTime(vol * 0.8, t);
      crackG.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      crack.connect(crackHP).connect(crackG).connect(destination);
      crack.start(t); crack.stop(t + 0.03);
      // Muzzle blast body — pink noise bandpass
      const blast = ctx.createBufferSource();
      blast.buffer = this.getPinkNoise(ctx, dur);
      const blastBP = ctx.createBiquadFilter();
      blastBP.type = 'bandpass';
      blastBP.frequency.setValueAtTime(profile === 'marksman' ? 600 : 900, t);
      blastBP.frequency.exponentialRampToValueAtTime(120, t + dur); blastBP.Q.value = 0.6;
      const blastG = ctx.createGain();
      blastG.gain.setValueAtTime(vol * 0.55, t);
      blastG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      blast.connect(blastBP).connect(blastG).connect(destination);
      blast.start(t); blast.stop(t + dur);
      // Sub concussion — sine only
      const sub = ctx.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(profile === 'marksman' ? 65 : 80, t);
      sub.frequency.exponentialRampToValueAtTime(30, t + dur * 0.5);
      const subG = ctx.createGain();
      subG.gain.setValueAtTime(vol * 0.3, t);
      subG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.5);
      sub.connect(subG).connect(destination); sub.start(t); sub.stop(t + dur * 0.5);
      // Echo tail — brown noise lowpass
      const tail = ctx.createBufferSource();
      tail.buffer = this.getBrownNoise(ctx, dur * 1.4);
      const tailLP = ctx.createBiquadFilter();
      tailLP.type = 'lowpass'; tailLP.frequency.value = profile === 'marksman' ? 300 : 200;
      const tailG = ctx.createGain();
      tailG.gain.setValueAtTime(0.001, t);
      tailG.gain.linearRampToValueAtTime(vol * 0.12, t + dur * 0.15);
      tailG.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.3);
      tail.connect(tailLP).connect(tailG).connect(destination);
      tail.start(t + 0.01); tail.stop(t + dur * 1.4);
      scheduleRelease(dur * 1.4);

    } else if (type === 'scream') {
      // ── Human scream: formant-filtered noise, breathy not tonal ──
      const dur = 0.8;
      // Vocal cord noise — pink noise through two formant bandpasses
      const vocal = ctx.createBufferSource();
      vocal.buffer = this.getPinkNoise(ctx, dur);
      const formant1 = ctx.createBiquadFilter();
      formant1.type = 'bandpass';
      formant1.frequency.setValueAtTime(900 + Math.random() * 200, t);
      formant1.frequency.linearRampToValueAtTime(550 + Math.random() * 100, t + dur);
      formant1.Q.value = 6;
      const formant2 = ctx.createBiquadFilter();
      formant2.type = 'bandpass';
      formant2.frequency.setValueAtTime(2200 + Math.random() * 300, t);
      formant2.frequency.linearRampToValueAtTime(1400 + Math.random() * 200, t + dur);
      formant2.Q.value = 4;
      const vocalG1 = ctx.createGain();
      vocalG1.gain.setValueAtTime(0.2, t); vocalG1.gain.linearRampToValueAtTime(0.001, t + dur);
      const vocalG2 = ctx.createGain();
      vocalG2.gain.setValueAtTime(0.08, t); vocalG2.gain.linearRampToValueAtTime(0.001, t + dur * 0.7);
      vocal.connect(formant1).connect(vocalG1).connect(destination);
      vocal.connect(formant2).connect(vocalG2).connect(destination);
      vocal.start(t); vocal.stop(t + dur);
      // Breath rush — white noise highpass
      const breath = ctx.createBufferSource();
      breath.buffer = this.getNoiseBuffer(ctx, dur * 0.6);
      const breathHP = ctx.createBiquadFilter();
      breathHP.type = 'highpass'; breathHP.frequency.value = 2600;
      const breathG = ctx.createGain();
      breathG.gain.setValueAtTime(0.04, t); breathG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.5);
      breath.connect(breathHP).connect(breathG).connect(destination);
      breath.start(t); breath.stop(t + dur * 0.6);
      // Chest resonance — brown noise lowpass
      const chest = ctx.createBufferSource();
      chest.buffer = this.getBrownNoise(ctx, dur);
      const chestLP = ctx.createBiquadFilter();
      chestLP.type = 'lowpass'; chestLP.frequency.value = 180;
      const chestG = ctx.createGain();
      chestG.gain.setValueAtTime(0.06, t); chestG.gain.linearRampToValueAtTime(0.001, t + dur);
      chest.connect(chestLP).connect(chestG).connect(destination);
      chest.start(t); chest.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'kaiju_roar') {
      // ── Monster roar: massive noise-based vocal + sub-bass ──
      const dur = 2.4;
      // Core bellow — brown noise lowpassed heavily
      const bellow = ctx.createBufferSource();
      bellow.buffer = this.getBrownNoise(ctx, dur);
      const bellowLP = ctx.createBiquadFilter();
      bellowLP.type = 'lowpass';
      bellowLP.frequency.setValueAtTime(420, t);
      bellowLP.frequency.linearRampToValueAtTime(80, t + dur);
      const bellowG = ctx.createGain();
      bellowG.gain.setValueAtTime(0.001, t);
      bellowG.gain.linearRampToValueAtTime(0.35, t + 0.15);
      bellowG.gain.linearRampToValueAtTime(0.28, t + dur * 0.5);
      bellowG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      bellow.connect(bellowLP).connect(bellowG).connect(destination);
      bellow.start(t); bellow.stop(t + dur);
      // Vocal formant — pink noise through resonant bandpass
      const vocal = ctx.createBufferSource();
      vocal.buffer = this.getPinkNoise(ctx, dur);
      const vocalBP = ctx.createBiquadFilter();
      vocalBP.type = 'bandpass';
      vocalBP.frequency.setValueAtTime(280, t);
      vocalBP.frequency.linearRampToValueAtTime(140, t + dur); vocalBP.Q.value = 2.5;
      const vocalG = ctx.createGain();
      vocalG.gain.setValueAtTime(0.001, t);
      vocalG.gain.linearRampToValueAtTime(0.18, t + 0.2);
      vocalG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.8);
      vocal.connect(vocalBP).connect(vocalG).connect(destination);
      vocal.start(t); vocal.stop(t + dur);
      // Sub-bass earth shake — sine only
      const sub = ctx.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(24, t); sub.frequency.exponentialRampToValueAtTime(10, t + dur);
      const subG = ctx.createGain();
      subG.gain.setValueAtTime(0.001, t);
      subG.gain.linearRampToValueAtTime(0.32, t + 0.1);
      subG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      sub.connect(subG).connect(destination); sub.start(t); sub.stop(t + dur);
      // High shriek layer — noise burst
      const shriek = ctx.createBufferSource();
      shriek.buffer = this.getNoiseBuffer(ctx, dur * 0.4);
      const shriekBP = ctx.createBiquadFilter();
      shriekBP.type = 'bandpass'; shriekBP.frequency.setValueAtTime(1600, t);
      shriekBP.frequency.linearRampToValueAtTime(600, t + dur * 0.4); shriekBP.Q.value = 3;
      const shriekG = ctx.createGain();
      shriekG.gain.setValueAtTime(0.001, t);
      shriekG.gain.linearRampToValueAtTime(0.08, t + 0.08);
      shriekG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.35);
      shriek.connect(shriekBP).connect(shriekG).connect(destination);
      shriek.start(t); shriek.stop(t + dur * 0.4);
      scheduleRelease(dur);

    } else if (type === 'fire_breath') {
      // ── Flamethrower: sustained noise roar ──
      const dur = 1.0;
      // Main flame — pink noise through rising-then-falling bandpass
      const flame = ctx.createBufferSource();
      flame.buffer = this.getPinkNoise(ctx, dur);
      const flameBP = ctx.createBiquadFilter();
      flameBP.type = 'bandpass';
      flameBP.frequency.setValueAtTime(200, t);
      flameBP.frequency.linearRampToValueAtTime(1200, t + dur * 0.25);
      flameBP.frequency.linearRampToValueAtTime(100, t + dur); flameBP.Q.value = 0.4;
      const flameG = ctx.createGain();
      flameG.gain.setValueAtTime(0.001, t);
      flameG.gain.linearRampToValueAtTime(0.22, t + 0.08);
      flameG.gain.linearRampToValueAtTime(0.18, t + dur * 0.6);
      flameG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      flame.connect(flameBP).connect(flameG).connect(destination);
      flame.start(t); flame.stop(t + dur);
      // Gas rush — white noise highpass
      const gas = ctx.createBufferSource();
      gas.buffer = this.getNoiseBuffer(ctx, dur * 0.7);
      const gasHP = ctx.createBiquadFilter();
      gasHP.type = 'highpass'; gasHP.frequency.setValueAtTime(1800, t);
      gasHP.frequency.linearRampToValueAtTime(800, t + dur * 0.7);
      const gasG = ctx.createGain();
      gasG.gain.setValueAtTime(0.06, t); gasG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.6);
      gas.connect(gasHP).connect(gasG).connect(destination);
      gas.start(t); gas.stop(t + dur * 0.7);
      // Sub bass rumble — brown noise lowpass
      const rumble = ctx.createBufferSource();
      rumble.buffer = this.getBrownNoise(ctx, dur);
      const rumbleLP = ctx.createBiquadFilter();
      rumbleLP.type = 'lowpass'; rumbleLP.frequency.value = 80;
      const rumbleG = ctx.createGain();
      rumbleG.gain.setValueAtTime(0.1, t); rumbleG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      rumble.connect(rumbleLP).connect(rumbleG).connect(destination);
      rumble.start(t); rumble.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'missile_launch') {
      // ── Rocket motor ignition: whoosh + pressure pop ──
      const dur = 0.5;
      // Ignition pop — white noise burst
      const pop = ctx.createBufferSource();
      pop.buffer = this.getNoiseBuffer(ctx, 0.04);
      const popHP = ctx.createBiquadFilter();
      popHP.type = 'highpass'; popHP.frequency.value = 1400;
      const popG = ctx.createGain();
      popG.gain.setValueAtTime(0.2, t); popG.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      pop.connect(popHP).connect(popG).connect(destination);
      pop.start(t); pop.stop(t + 0.04);
      // Motor burn — pink noise bandpass sweep upward
      const motor = ctx.createBufferSource();
      motor.buffer = this.getPinkNoise(ctx, dur);
      const motorBP = ctx.createBiquadFilter();
      motorBP.type = 'bandpass';
      motorBP.frequency.setValueAtTime(180, t);
      motorBP.frequency.exponentialRampToValueAtTime(1400, t + dur * 0.7); motorBP.Q.value = 0.5;
      const motorG = ctx.createGain();
      motorG.gain.setValueAtTime(0.22, t);
      motorG.gain.linearRampToValueAtTime(0.12, t + dur * 0.5);
      motorG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      motor.connect(motorBP).connect(motorG).connect(destination);
      motor.start(t); motor.stop(t + dur);
      // Sub thump
      const sub = ctx.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(48, t); sub.frequency.exponentialRampToValueAtTime(25, t + 0.15);
      const subG = ctx.createGain();
      subG.gain.setValueAtTime(0.15, t); subG.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      sub.connect(subG).connect(destination); sub.start(t); sub.stop(t + 0.15);
      scheduleRelease(dur);

    } else if (type === 'target_confirm') {
      // ── Soft UI chirp: filtered noise tick, not a beep ──
      const dur = 0.14;
      const tick = ctx.createBufferSource();
      tick.buffer = this.getNoiseBuffer(ctx, dur);
      const tickBP = ctx.createBiquadFilter();
      tickBP.type = 'bandpass'; tickBP.frequency.value = 2800; tickBP.Q.value = 12;
      const tickG = ctx.createGain();
      tickG.gain.setValueAtTime(0.07, t);
      tickG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      tick.connect(tickBP).connect(tickG).connect(destination);
      tick.start(t); tick.stop(t + dur);
      // Sub click
      const click = ctx.createBufferSource();
      click.buffer = this.getBrownNoise(ctx, 0.03);
      const clickLP = ctx.createBiquadFilter();
      clickLP.type = 'lowpass'; clickLP.frequency.value = 400;
      const clickG = ctx.createGain();
      clickG.gain.setValueAtTime(0.04, t); clickG.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      click.connect(clickLP).connect(clickG).connect(destination);
      click.start(t); click.stop(t + 0.03);
      scheduleRelease(dur);

    } else if (type === 'target_blocked') {
      // ── UI reject: low thud, not a buzzer ──
      const dur = 0.18;
      const thud = ctx.createBufferSource();
      thud.buffer = this.getBrownNoise(ctx, dur);
      const thudLP = ctx.createBiquadFilter();
      thudLP.type = 'lowpass'; thudLP.frequency.setValueAtTime(200, t);
      thudLP.frequency.exponentialRampToValueAtTime(60, t + dur);
      const thudG = ctx.createGain();
      thudG.gain.setValueAtTime(0.06, t); thudG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      thud.connect(thudLP).connect(thudG).connect(destination);
      thud.start(t); thud.stop(t + dur);
      // Rattle — pink noise bandpass
      const rattle = ctx.createBufferSource();
      rattle.buffer = this.getPinkNoise(ctx, dur);
      const rattleBP = ctx.createBiquadFilter();
      rattleBP.type = 'bandpass'; rattleBP.frequency.value = 340; rattleBP.Q.value = 2;
      const rattleG = ctx.createGain();
      rattleG.gain.setValueAtTime(0.03, t); rattleG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      rattle.connect(rattleBP).connect(rattleG).connect(destination);
      rattle.start(t); rattle.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'bomb_whistle') {
      // ── Falling ordnance: air-tearing noise, not a pitched whistle ──
      const dur = options.duration || 1.6;
      const vol = options.volume || 0.075;
      // Descending wind tear — white noise through sweeping bandpass
      const tear = ctx.createBufferSource();
      tear.buffer = this.getNoiseBuffer(ctx, dur);
      const tearBP = ctx.createBiquadFilter();
      tearBP.type = 'bandpass';
      tearBP.frequency.setValueAtTime(3200, t);
      tearBP.frequency.exponentialRampToValueAtTime(300, t + dur); tearBP.Q.value = 6;
      const tearG = ctx.createGain();
      tearG.gain.setValueAtTime(vol * 0.7, t);
      tearG.gain.linearRampToValueAtTime(vol, t + dur * 0.4);
      tearG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      tear.connect(tearBP).connect(tearG).connect(destination);
      tear.start(t); tear.stop(t + dur);
      // Low air compression — brown noise
      const comp = ctx.createBufferSource();
      comp.buffer = this.getBrownNoise(ctx, dur);
      const compLP = ctx.createBiquadFilter();
      compLP.type = 'lowpass'; compLP.frequency.setValueAtTime(160, t);
      compLP.frequency.linearRampToValueAtTime(300, t + dur);
      const compG = ctx.createGain();
      compG.gain.setValueAtTime(vol * 0.3, t);
      compG.gain.linearRampToValueAtTime(vol * 0.6, t + dur * 0.7);
      compG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      comp.connect(compLP).connect(compG).connect(destination);
      comp.start(t); comp.stop(t + dur);
      // Flutter — pink noise tight resonance
      const flutter = ctx.createBufferSource();
      flutter.buffer = this.getPinkNoise(ctx, dur);
      const flutterBP = ctx.createBiquadFilter();
      flutterBP.type = 'bandpass';
      flutterBP.frequency.setValueAtTime(1600, t);
      flutterBP.frequency.exponentialRampToValueAtTime(180, t + dur); flutterBP.Q.value = 10;
      const flutterG = ctx.createGain();
      flutterG.gain.setValueAtTime(vol * 0.2, t);
      flutterG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.9);
      flutter.connect(flutterBP).connect(flutterG).connect(destination);
      flutter.start(t); flutter.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'kaiju_step') {
      // ── Massive footfall: ground impact, no pitched tone ──
      const dur = 0.35;
      // Impact thud — brown noise lowpassed
      const impact = ctx.createBufferSource();
      impact.buffer = this.getBrownNoise(ctx, dur);
      const impactLP = ctx.createBiquadFilter();
      impactLP.type = 'lowpass'; impactLP.frequency.setValueAtTime(90, t);
      impactLP.frequency.exponentialRampToValueAtTime(30, t + dur);
      const impactG = ctx.createGain();
      impactG.gain.setValueAtTime(0.16, t); impactG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      impact.connect(impactLP).connect(impactG).connect(destination);
      impact.start(t); impact.stop(t + dur);
      // Sub thump — sine
      const sub = ctx.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(38, t); sub.frequency.exponentialRampToValueAtTime(14, t + dur * 0.6);
      const subG = ctx.createGain();
      subG.gain.setValueAtTime(0.14, t); subG.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.6);
      sub.connect(subG).connect(destination); sub.start(t); sub.stop(t + dur * 0.6);
      // Debris scatter — pink noise bandpass
      const scatter = ctx.createBufferSource();
      scatter.buffer = this.getPinkNoise(ctx, dur);
      const scatterBP = ctx.createBiquadFilter();
      scatterBP.type = 'bandpass'; scatterBP.frequency.setValueAtTime(400, t);
      scatterBP.frequency.exponentialRampToValueAtTime(100, t + dur); scatterBP.Q.value = 0.6;
      const scatterG = ctx.createGain();
      scatterG.gain.setValueAtTime(0.001, t);
      scatterG.gain.linearRampToValueAtTime(0.06, t + 0.04);
      scatterG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      scatter.connect(scatterBP).connect(scatterG).connect(destination);
      scatter.start(t + 0.02); scatter.stop(t + dur);
      scheduleRelease(dur);

    } else if (type === 'brrt') {
      // ══════════════════════════════════════════════════════════════
      // GAU-8 AVENGER "BRRRT" — 30mm Gatling cannon burst
      // The iconic A-10 sound: deep, fast, tearing mechanical rasp
      // GAU-8 fires at ~65 rounds/sec — produces a 55-70Hz tonal character
      // ══════════════════════════════════════════════════════════════
      const dur = options.duration || 2.1;
      const vol = options.volume || 1.0;

      // ── Layer 1: Deep tonal rasp — the barrel-rotation fundamental ──
      // At ~65 Hz cycling rate, creates the signature low groan
      const rasper = ctx.createOscillator();
      rasper.type = 'sawtooth';
      rasper.frequency.setValueAtTime(62, t);
      rasper.frequency.setValueAtTime(66, t + 0.08);
      rasper.frequency.setValueAtTime(60, t + dur * 0.5);
      rasper.frequency.exponentialRampToValueAtTime(42, t + dur);
      const rasperG = ctx.createGain();
      rasperG.gain.setValueAtTime(0.001, t);
      rasperG.gain.linearRampToValueAtTime(vol * 0.34, t + 0.04);
      rasperG.gain.setValueAtTime(vol * 0.30, t + dur * 0.6);
      rasperG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      rasper.connect(rasperG).connect(destination);
      rasper.start(t); rasper.stop(t + dur);

      // ── Layer 2: Mechanical rattle — rapid brown-noise AM at barrel rate ──
      const rattle = ctx.createBufferSource();
      rattle.buffer = this.getBrownNoise(ctx, dur);
      const rattleLP = ctx.createBiquadFilter();
      rattleLP.type = 'lowpass';
      rattleLP.frequency.setValueAtTime(420, t);
      rattleLP.frequency.linearRampToValueAtTime(180, t + dur * 0.8);
      rattleLP.frequency.exponentialRampToValueAtTime(50, t + dur);
      const rattleHP = ctx.createBiquadFilter();
      rattleHP.type = 'highpass';
      rattleHP.frequency.value = 48;
      // AM tremolo at 65 Hz to simulate discrete round firings
      const tremoloOsc = ctx.createOscillator();
      tremoloOsc.type = 'square';
      tremoloOsc.frequency.setValueAtTime(65, t);
      tremoloOsc.frequency.setValueAtTime(62, t + dur * 0.5);
      const tremoloGain = ctx.createGain();
      tremoloGain.gain.setValueAtTime(0.0, t);
      tremoloGain.gain.linearRampToValueAtTime(0.3, t + 0.05);
      tremoloGain.gain.setValueAtTime(0.25, t + dur * 0.6);
      tremoloGain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      tremoloOsc.connect(tremoloGain).connect(rattleLP);
      tremoloOsc.start(t); tremoloOsc.stop(t + dur);
      const rattleG = ctx.createGain();
      rattleG.gain.setValueAtTime(0.001, t);
      rattleG.gain.linearRampToValueAtTime(vol * 0.42, t + 0.03);
      rattleG.gain.setValueAtTime(vol * 0.38, t + dur * 0.55);
      rattleG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      rattle.connect(rattleLP).connect(rattleHP).connect(rattleG).connect(destination);
      rattle.start(t); rattle.stop(t + dur);

      // ── Layer 3: High-frequency 30mm crack — white noise bursts ──
      // Each round produces a sharp supersonic crack as it leaves the barrel
      const snap = ctx.createBufferSource();
      snap.buffer = this.getNoiseBuffer(ctx, dur);
      const snapHP = ctx.createBiquadFilter();
      snapHP.type = 'highpass';
      snapHP.frequency.setValueAtTime(2800, t);
      snapHP.frequency.linearRampToValueAtTime(1200, t + dur);
      const snapG = ctx.createGain();
      snapG.gain.setValueAtTime(0.001, t);
      snapG.gain.linearRampToValueAtTime(vol * 0.18, t + 0.04);
      snapG.gain.setValueAtTime(vol * 0.14, t + dur * 0.7);
      snapG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      snap.connect(snapHP).connect(snapG).connect(destination);
      snap.start(t); snap.stop(t + dur);

      // ── Layer 4: Sub impact thud — the ground/airframe vibration ──
      const subThud = ctx.createOscillator();
      subThud.type = 'sine';
      subThud.frequency.setValueAtTime(34, t);
      subThud.frequency.exponentialRampToValueAtTime(18, t + dur);
      const subTG = ctx.createGain();
      subTG.gain.setValueAtTime(0.001, t);
      subTG.gain.linearRampToValueAtTime(vol * 0.22, t + 0.06);
      subTG.gain.setValueAtTime(vol * 0.18, t + dur * 0.5);
      subTG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      subThud.connect(subTG).connect(destination);
      subThud.start(t); subThud.stop(t + dur);

      // ── ECHO LAYERS — the iconic "bwhhhhh" bounce off terrain ──
      // In famous A-10 videos: gun stops → brief silence → deep rolling echo washes back
      // Only the low-frequency energy survives long-distance travel; highs scatter away
      const echoDelay  = dur + 0.44;   // first reflection (~75m from terrain)
      const echoDelay2 = dur + 0.92;   // second reflection (farther terrain / hills)
      const echoVol    = vol * 0.38;

      // Echo 1: muffled brown-noise body — the deep "bwhhhhh" roll
      const echo1 = ctx.createBufferSource();
      echo1.buffer = this.getBrownNoise(ctx, 1.6);
      const echo1LP = ctx.createBiquadFilter();
      echo1LP.type = 'lowpass';
      echo1LP.frequency.setValueAtTime(300, t + echoDelay);
      echo1LP.frequency.exponentialRampToValueAtTime(36, t + echoDelay + 1.4);
      const echo1G = ctx.createGain();
      echo1G.gain.setValueAtTime(0.001, t + echoDelay);
      echo1G.gain.linearRampToValueAtTime(echoVol, t + echoDelay + 0.05);
      echo1G.gain.setValueAtTime(echoVol * 0.82, t + echoDelay + 0.5);
      echo1G.gain.exponentialRampToValueAtTime(0.001, t + echoDelay + 1.6);
      echo1.connect(echo1LP).connect(echo1G).connect(destination);
      echo1.start(t + echoDelay); echo1.stop(t + echoDelay + 1.6);

      // Echo 1 tonal rasp — the muffled pitch character of the cannon echoing back
      const echoRasp = ctx.createOscillator();
      echoRasp.type = 'sawtooth';
      echoRasp.frequency.setValueAtTime(52, t + echoDelay);
      echoRasp.frequency.exponentialRampToValueAtTime(26, t + echoDelay + 1.2);
      const echoRaspLP = ctx.createBiquadFilter();
      echoRaspLP.type = 'lowpass';
      echoRaspLP.frequency.setValueAtTime(190, t + echoDelay);
      echoRaspLP.frequency.exponentialRampToValueAtTime(42, t + echoDelay + 1.1);
      const echoRaspG = ctx.createGain();
      echoRaspG.gain.setValueAtTime(0.001, t + echoDelay);
      echoRaspG.gain.linearRampToValueAtTime(echoVol * 0.50, t + echoDelay + 0.04);
      echoRaspG.gain.setValueAtTime(echoVol * 0.38, t + echoDelay + 0.5);
      echoRaspG.gain.exponentialRampToValueAtTime(0.001, t + echoDelay + 1.2);
      echoRasp.connect(echoRaspLP).connect(echoRaspG).connect(destination);
      echoRasp.start(t + echoDelay); echoRasp.stop(t + echoDelay + 1.2);

      // Echo 2: distant second reflection — even more muffled, barely-audible rumble
      const echo2 = ctx.createBufferSource();
      echo2.buffer = this.getBrownNoise(ctx, 1.1);
      const echo2LP = ctx.createBiquadFilter();
      echo2LP.type = 'lowpass';
      echo2LP.frequency.setValueAtTime(130, t + echoDelay2);
      echo2LP.frequency.exponentialRampToValueAtTime(20, t + echoDelay2 + 0.9);
      const echo2G = ctx.createGain();
      echo2G.gain.setValueAtTime(0.001, t + echoDelay2);
      echo2G.gain.linearRampToValueAtTime(echoVol * 0.20, t + echoDelay2 + 0.07);
      echo2G.gain.exponentialRampToValueAtTime(0.001, t + echoDelay2 + 1.1);
      echo2.connect(echo2LP).connect(echo2G).connect(destination);
      echo2.start(t + echoDelay2); echo2.stop(t + echoDelay2 + 1.1);

      scheduleRelease(dur + 2.1);  // hold slot until echoes fully decay

    } else if (type === 'build_select') {
      // ══════════════════════════════════════════════════════════════
      // BUILD SELECT — player arms a building type in the HUD
      // Crisp metallic tick + short sine ping: "ready to place"
      // ══════════════════════════════════════════════════════════════
      const dur = 0.28;
      const vol = options.volume || 0.75;
      // Layer 1: Crisp white-noise tick — blueprint click, high-mid bandpass
      const tick = ctx.createBufferSource();
      tick.buffer = this.getNoiseBuffer(ctx, 0.07);
      const tickBP = ctx.createBiquadFilter();
      tickBP.type = 'bandpass'; tickBP.frequency.value = 1900; tickBP.Q.value = 14;
      const tickG = ctx.createGain();
      tickG.gain.setValueAtTime(vol * 0.55, t);
      tickG.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      tick.connect(tickBP).connect(tickG).connect(destination);
      tick.start(t); tick.stop(t + 0.07);
      // Layer 2: Metallic sine ping — short ring that confirms "armed"
      const ping = ctx.createOscillator(); ping.type = 'sine';
      ping.frequency.setValueAtTime(1020, t);
      ping.frequency.exponentialRampToValueAtTime(510, t + 0.18);
      const pingG = ctx.createGain();
      pingG.gain.setValueAtTime(0.001, t);
      pingG.gain.linearRampToValueAtTime(vol * 0.28, t + 0.012);
      pingG.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      ping.connect(pingG).connect(destination);
      ping.start(t); ping.stop(t + 0.18);
      // Layer 3: Sub bass grounding click
      const bass = ctx.createBufferSource();
      bass.buffer = this.getBrownNoise(ctx, 0.05);
      const bassLP = ctx.createBiquadFilter();
      bassLP.type = 'lowpass'; bassLP.frequency.value = 280;
      const bassG = ctx.createGain();
      bassG.gain.setValueAtTime(vol * 0.30, t);
      bassG.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      bass.connect(bassLP).connect(bassG).connect(destination);
      bass.start(t); bass.stop(t + 0.05);
      scheduleRelease(dur);

    } else if (type === 'build_place') {
      // ══════════════════════════════════════════════════════════════
      // BUILD PLACE — foundation dropped, construction begins
      // Heavy thud + concrete impact + gravel scatter + metallic clank
      // ══════════════════════════════════════════════════════════════
      const dur = 0.85;
      const vol = options.volume || 0.9;
      // Layer 1: Earth thud — brown noise steep lowpass, subsidence
      const earth = ctx.createBufferSource();
      earth.buffer = this.getBrownNoise(ctx, 0.55);
      const earthLP = ctx.createBiquadFilter();
      earthLP.type = 'lowpass';
      earthLP.frequency.setValueAtTime(130, t);
      earthLP.frequency.exponentialRampToValueAtTime(28, t + 0.5);
      const earthG = ctx.createGain();
      earthG.gain.setValueAtTime(0.001, t);
      earthG.gain.linearRampToValueAtTime(vol * 0.58, t + 0.018);
      earthG.gain.setValueAtTime(vol * 0.52, t + 0.06);
      earthG.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      earth.connect(earthLP).connect(earthG).connect(destination);
      earth.start(t); earth.stop(t + 0.55);
      // Layer 2: Sub thump — sine 72→22Hz, chest-punch foundation drop
      const sub = ctx.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(72, t);
      sub.frequency.exponentialRampToValueAtTime(22, t + 0.42);
      const subG = ctx.createGain();
      subG.gain.setValueAtTime(0.001, t);
      subG.gain.linearRampToValueAtTime(vol * 0.42, t + 0.014);
      subG.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      sub.connect(subG).connect(destination);
      sub.start(t); sub.stop(t + 0.42);
      // Layer 3: Metallic clank — white noise HP narrow burst (beam drop)
      const clank = ctx.createBufferSource();
      clank.buffer = this.getNoiseBuffer(ctx, 0.13);
      const clankHP = ctx.createBiquadFilter();
      clankHP.type = 'highpass'; clankHP.frequency.value = 2400;
      const clankLP = ctx.createBiquadFilter();
      clankLP.type = 'lowpass'; clankLP.frequency.value = 5500;
      const clankG = ctx.createGain();
      clankG.gain.setValueAtTime(vol * 0.22, t + 0.01);
      clankG.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      clank.connect(clankHP).connect(clankLP).connect(clankG).connect(destination);
      clank.start(t + 0.01); clank.stop(t + 0.13);
      // Layer 4: Gravel scatter — pink noise bandpass settling
      const gravel = ctx.createBufferSource();
      gravel.buffer = this.getPinkNoise(ctx, 0.75);
      const gravelBP = ctx.createBiquadFilter();
      gravelBP.type = 'bandpass';
      gravelBP.frequency.setValueAtTime(420, t + 0.05);
      gravelBP.frequency.exponentialRampToValueAtTime(90, t + 0.75);
      gravelBP.Q.value = 0.55;
      const gravelG = ctx.createGain();
      gravelG.gain.setValueAtTime(0.001, t);
      gravelG.gain.linearRampToValueAtTime(vol * 0.18, t + 0.07);
      gravelG.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
      gravel.connect(gravelBP).connect(gravelG).connect(destination);
      gravel.start(t + 0.05); gravel.stop(t + 0.75);
      scheduleRelease(dur);

    } else if (type === 'build_complete') {
      // ══════════════════════════════════════════════════════════════
      // BUILD COMPLETE — construction finished, building online
      // Two-tone chime (perfect fifth G5+D6) + deep resonance hum
      // Satisfying but not cheesy — military/industrial tone
      // ══════════════════════════════════════════════════════════════
      const dur = 1.4;
      const vol = options.volume || 0.82;
      // Layer 1: Bell tone 1 — 784 Hz (G5), primary note
      const bell1 = ctx.createOscillator(); bell1.type = 'sine';
      bell1.frequency.value = 784;
      const bell1G = ctx.createGain();
      bell1G.gain.setValueAtTime(0.001, t);
      bell1G.gain.linearRampToValueAtTime(vol * 0.38, t + 0.016);
      bell1G.gain.setValueAtTime(vol * 0.30, t + 0.12);
      bell1G.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      bell1.connect(bell1G).connect(destination);
      bell1.start(t); bell1.stop(t + 0.9);
      // Layer 2: Bell tone 2 — 1176 Hz (D6, perfect fifth above), arrives 80ms later
      const bell2 = ctx.createOscillator(); bell2.type = 'sine';
      bell2.frequency.value = 1176;
      const bell2G = ctx.createGain();
      bell2G.gain.setValueAtTime(0.001, t + 0.08);
      bell2G.gain.linearRampToValueAtTime(vol * 0.26, t + 0.1);
      bell2G.gain.setValueAtTime(vol * 0.20, t + 0.22);
      bell2G.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
      bell2.connect(bell2G).connect(destination);
      bell2.start(t + 0.08); bell2.stop(t + 0.85);
      // Layer 3: Sub harmonic resonance — 196 Hz (G3) under-hum, swells in
      const resonance = ctx.createOscillator(); resonance.type = 'sine';
      resonance.frequency.value = 196;
      const resG = ctx.createGain();
      resG.gain.setValueAtTime(0.001, t);
      resG.gain.linearRampToValueAtTime(vol * 0.20, t + 0.28);
      resG.gain.setValueAtTime(vol * 0.18, t + 0.6);
      resG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      resonance.connect(resG).connect(destination);
      resonance.start(t); resonance.stop(t + dur);
      // Layer 4: Bright shimmer — white noise HP 4200Hz, instant burst to confirm
      const shimmer = ctx.createBufferSource();
      shimmer.buffer = this.getNoiseBuffer(ctx, 0.06);
      const shimmerHP = ctx.createBiquadFilter();
      shimmerHP.type = 'highpass'; shimmerHP.frequency.value = 4200;
      const shimmerG = ctx.createGain();
      shimmerG.gain.setValueAtTime(vol * 0.12, t);
      shimmerG.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      shimmer.connect(shimmerHP).connect(shimmerG).connect(destination);
      shimmer.start(t); shimmer.stop(t + 0.06);
      scheduleRelease(dur);

    } else if (type === 'build_destroy') {
      // ══════════════════════════════════════════════════════════════
      // BUILD DESTROY — structural collapse, building destroyed
      // Groan → heavy crash → concrete crumble → debris rain
      // ══════════════════════════════════════════════════════════════
      const dur = 2.0;
      const vol = options.volume || 0.88;
      // Layer 1: Structural groan — sawtooth 175→40→18Hz (bending steel beam)
      const groan = ctx.createOscillator(); groan.type = 'sawtooth';
      groan.frequency.setValueAtTime(175, t);
      groan.frequency.exponentialRampToValueAtTime(40, t + 0.55);
      groan.frequency.exponentialRampToValueAtTime(18, t + 1.0);
      const groanLP = ctx.createBiquadFilter();
      groanLP.type = 'lowpass'; groanLP.frequency.value = 380;
      const groanG = ctx.createGain();
      groanG.gain.setValueAtTime(0.001, t);
      groanG.gain.linearRampToValueAtTime(vol * 0.32, t + 0.04);
      groanG.gain.setValueAtTime(vol * 0.26, t + 0.35);
      groanG.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
      groan.connect(groanLP).connect(groanG).connect(destination);
      groan.start(t); groan.stop(t + 1.0);
      // Layer 2: Collapse body — brown noise, heavy wall coming down
      const collapse = ctx.createBufferSource();
      collapse.buffer = this.getBrownNoise(ctx, dur);
      const collapseLP = ctx.createBiquadFilter();
      collapseLP.type = 'lowpass';
      collapseLP.frequency.setValueAtTime(380, t);
      collapseLP.frequency.exponentialRampToValueAtTime(18, t + dur * 0.8);
      const collapseG = ctx.createGain();
      collapseG.gain.setValueAtTime(0.001, t);
      collapseG.gain.linearRampToValueAtTime(vol * 0.55, t + 0.03);
      collapseG.gain.setValueAtTime(vol * 0.48, t + 0.3);
      collapseG.gain.exponentialRampToValueAtTime(0.001, t + dur);
      collapse.connect(collapseLP).connect(collapseG).connect(destination);
      collapse.start(t); collapse.stop(t + dur);
      // Layer 3: Concrete crumble — pink noise bandpass, mid-range rubble
      const crumble = ctx.createBufferSource();
      crumble.buffer = this.getPinkNoise(ctx, 1.3);
      const crumbleBP = ctx.createBiquadFilter();
      crumbleBP.type = 'bandpass';
      crumbleBP.frequency.setValueAtTime(520, t + 0.05);
      crumbleBP.frequency.exponentialRampToValueAtTime(95, t + 1.3);
      crumbleBP.Q.value = 0.45;
      const crumbleG = ctx.createGain();
      crumbleG.gain.setValueAtTime(0.001, t);
      crumbleG.gain.linearRampToValueAtTime(vol * 0.28, t + 0.1);
      crumbleG.gain.setValueAtTime(vol * 0.22, t + 0.5);
      crumbleG.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
      crumble.connect(crumbleBP).connect(crumbleG).connect(destination);
      crumble.start(t + 0.05); crumble.stop(t + 1.3);
      // Layer 4: Metal tear burst — white noise HP, sharp initial rip
      const tear = ctx.createBufferSource();
      tear.buffer = this.getNoiseBuffer(ctx, 0.18);
      const tearHP = ctx.createBiquadFilter();
      tearHP.type = 'highpass'; tearHP.frequency.value = 2600;
      const tearG = ctx.createGain();
      tearG.gain.setValueAtTime(vol * 0.20, t);
      tearG.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      tear.connect(tearHP).connect(tearG).connect(destination);
      tear.start(t); tear.stop(t + 0.18);
      // Layer 5: Debris rain — pink noise settling, dust and chips
      const debris = ctx.createBufferSource();
      debris.buffer = this.getPinkNoise(ctx, 1.5);
      const debrisBP = ctx.createBiquadFilter();
      debrisBP.type = 'bandpass';
      debrisBP.frequency.setValueAtTime(1100, t + 0.4);
      debrisBP.frequency.exponentialRampToValueAtTime(180, t + 1.9);
      debrisBP.Q.value = 0.7;
      const debrisG = ctx.createGain();
      debrisG.gain.setValueAtTime(0.001, t);
      debrisG.gain.linearRampToValueAtTime(vol * 0.14, t + 0.5);
      debrisG.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
      debris.connect(debrisBP).connect(debrisG).connect(destination);
      debris.start(t + 0.4); debris.stop(t + 1.9);
      scheduleRelease(dur);

    } else {
      // Unknown type, release immediately — just remove from count
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
    scale: 1.22 + Math.random() * 0.28,
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
    scale: tankConfig.scale || (variant === 'apc' ? 1.12 : 1.72),
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
    ? 2.8
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
    productionQueue: [],
    trainingUnitType: null,
    trainingProgress: 0,
    trainingRemaining: 0,
    abilityActiveUntil: 0,
    abilityCooldownUntil: 0,
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

function createJetReinforcementFromFacility(id, kaiju, facility) {
  const startX = facility?.x ?? 0;
  const startZ = facility?.z ?? 0;
  const liftOffset = facility?.kind === 'radar_tower' ? 48 : 28;
  const angle = Math.atan2((kaiju?.z ?? 0) - startZ, (kaiju?.x ?? 0) - startX);
  const speed = 12;
  return {
    id,
    type: 'jet',
    x: startX + Math.cos(angle) * 36,
    y: (facility?.y || getTerrainHeight(startX, startZ)) + 56 + liftOffset,
    z: startZ + Math.sin(angle) * 36,
    vx: Math.cos(angle) * speed,
    vz: Math.sin(angle) * speed,
    targetKaiju: { x: kaiju.x, y: kaiju.y, z: kaiju.z },
    fired: false,
    launchedFromFacilityId: facility?.id || null,
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
    color: theme.name === 'militarybase' ? '#2f855a' : '#3fa34d',
    variant,
    trunkColor: theme.name === 'militarybase' ? '#8a5a30' : '#a66a3a',
    canopyColor: theme.name === 'militarybase' ? '#4f8b3a' : '#2f855a',
    canopyAccent: theme.name === 'militarybase' ? '#84cc16' : '#4ade80',
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
      ? ['#4a5a6e', '#5a6a7e', '#6a7a8e'][Math.floor(Math.random() * 3)]
      : ['#5a6a7e', '#6a7a8e', '#5e6e82'][Math.floor(Math.random() * 3)],
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

const getPersonLodLevel = (detailMode, distanceSq) => {
  const thresholds = detailMode === 'minimal'
    ? { full: 180 * 180, medium: 420 * 420 }
    : detailMode === 'lean'
    ? { full: 260 * 260, medium: 620 * 620 }
    : { full: 360 * 360, medium: 840 * 840 };

  if (distanceSq <= thresholds.full) return 'full';
  if (distanceSq <= thresholds.medium) return 'medium';
  return 'low';
};

// Realistic Fallout-style Human Character with Physics
const EntityPerson = memo(({ entityId, entityLookupRef, index, entitiesRef, qualityProfile }) => {
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
  const frameSkip = useRef(0);
  const nextLodCheckRef = useRef(0);
  const detailMode = qualityProfile?.detailMode || 'full';
  const [lodLevel, setLodLevel] = useState(detailMode === 'minimal' ? 'medium' : 'full');
  const lodLevelRef = useRef(lodLevel);
  const { camera } = useThree();

  useEffect(() => {
    const nextLevel = detailMode === 'minimal' ? 'medium' : detailMode === 'lean' ? 'medium' : 'full';
    lodLevelRef.current = nextLevel;
    setLodLevel(nextLevel);
  }, [detailMode]);
  
  // (Optimized: Cloth and hair physics are procedurally simulated via simple Math.sin for performance)
  
  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { 
      if (group.current) group.current.visible = false; 
      return; 
    }
    if (!group.current) return;

    if (state.clock.elapsedTime >= nextLodCheckRef.current) {
      const dx = camera.position.x - (p.x || 0);
      const dy = camera.position.y - ((p.y || 0) + 8);
      const dz = camera.position.z - (p.z || 0);
      const nextLevel = getPersonLodLevel(detailMode, dx * dx + dy * dy + dz * dz);
      if (nextLevel !== lodLevelRef.current) {
        lodLevelRef.current = nextLevel;
        setLodLevel(nextLevel);
      }
      nextLodCheckRef.current = state.clock.elapsedTime + 0.24;
    }
    
    const currentLod = lodLevelRef.current;
    const isLowLod = currentLod === 'low';
    const skipSecondaryMotion = currentLod !== 'full';
    const time = state.clock.elapsedTime;
    const ds = Math.min(delta, 0.05) * 60;
    
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

    // At low LOD (distant entity), skip expensive animation every other frame
    frameSkip.current = (frameSkip.current + 1) % 2;
    if (isLowLod && frameSkip.current !== 0) return;
    
    // Breathing animation - subtle chest expansion
    breathCycle.current = Math.sin(time * 2) * (isLowLod ? 0.012 : 0.02);
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
      
      const swing = Math.sin(walkCycle.current) * (isRunning ? 0.75 : 0.25) * (isLowLod ? 0.8 : 1);
      const armDrive = Math.sin(walkCycle.current + 0.35) * (isRunning ? 0.55 : 0.18) * (isLowLod ? 0.75 : 1);
      
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
      const bob = Math.abs(Math.sin(walkCycle.current * 2)) * (isRunning ? 0.2 : 0.05) * (isLowLod ? 0.85 : 1);
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
      const idleSway = Math.sin(time * 0.5) * (isLowLod ? 0.012 : 0.02);
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
    const windForce = skipSecondaryMotion ? 0 : Math.sin(time * 1.5) * 0.02;
    const movementForce = isMoving ? speed * (isLowLod ? 0.06 : 0.1) : 0;
    
    // Apply cloth physics to visual
    if (clothRef.current && !skipSecondaryMotion) {
      const clothSwing = movementForce * Math.sin(walkCycle.current);
      clothRef.current.rotation.x = clothSwing * 0.3;
      clothRef.current.rotation.z = windForce * 2;
    }
    
    // Apply hair physics
    if (hairRef.current && !skipSecondaryMotion) {
      const avgOffset = windForce * 10 + movementForce * Math.sin(walkCycle.current * 1.2) * 2;
      hairRef.current.rotation.z = avgOffset * 0.5;
    }
    
    // Gear swing physics (backpack, belt items)
    if (gearRef.current && !skipSecondaryMotion) {
      const gearSwing = Math.sin(walkCycle.current * 0.8) * (isMoving ? 0.1 : 0.02);
      gearRef.current.rotation.x = gearSwing;
    }
    
    // Head tracking - slight look around
    if (headRef.current) {
      const lookX = skipSecondaryMotion ? 0 : Math.sin(time * 0.3) * 0.1;
      const lookY = skipSecondaryMotion ? 0 : Math.sin(time * 0.2) * 0.05;
      headRef.current.rotation.y = lookX;
      headRef.current.rotation.x = lookY;
    }
    
    // Fleeing state - panic animation
    if (p.state === 'fleeing' && !skipSecondaryMotion) {
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
  const isSoldier = p.type === 'soldier';
  const renderFullDetails = lodLevel === 'full';
  const renderMediumDetails = lodLevel !== 'low';
  const headSegments = renderFullDetails ? 16 : 10;
  const eyeSegments = renderFullDetails ? 8 : 6;
  const hairSegments = renderFullDetails ? 12 : 8;
  const limbRadialSegments = renderFullDetails ? 8 : 6;
  const ringSegments = renderFullDetails ? 24 : 16;
  const hairStrands = Array.from({ length: renderFullDetails ? 6 : 3 }, (_, strandIndex) => ({
    key: `${seed}-${strandIndex}`,
    position: [
      Math.sin(seed * 0.47 + strandIndex * 1.37) * 0.38,
      0.08 + ((strandIndex % 3) * 0.12),
      Math.cos(seed * 0.31 + strandIndex * 0.91) * 0.22
    ],
    rotation: [
      Math.sin(seed * 0.23 + strandIndex * 0.52) * 0.22,
      (seed * 0.41 + strandIndex * 1.63) % (Math.PI * 2),
      0
    ]
  }));

  if (!renderMediumDetails) {
    return (
      <group ref={group} position={[p.x, 0, p.z]} scale={[p.scale, p.scale, p.scale]}>
        {p.selected && (
          <group position={[0, 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
            <mesh>
              <ringGeometry args={[9.2, 10.6, 14]} />
              <meshBasicMaterial color={p.weaponType === 'engineer' ? '#2dd4bf' : '#86efac'} transparent opacity={0.84} depthWrite={false} toneMapped={false} />
            </mesh>
          </group>
        )}
        <group ref={bodyRef} position={[0, 8, 0]}>
          <mesh>
            <boxGeometry args={[2.3, 4.1, 1.35]} />
            <meshStandardMaterial color={clothColor} roughness={0.92} metalness={0.08} />
          </mesh>
          {isSoldier && (
            <mesh position={[0, 0.1, 0.76]}>
              <boxGeometry args={[2.18, 2.15, 0.28]} />
              <meshStandardMaterial color={soldierVestColor} roughness={0.88} metalness={0.16} />
            </mesh>
          )}
        </group>
        <group ref={headRef} position={[0, 11.15, 0]}>
          <mesh>
            <sphereGeometry args={[1, 10, 10]} />
            <meshStandardMaterial color={skinTone} roughness={0.74} metalness={0} />
          </mesh>
          {isSoldier ? (
            <mesh position={[0, 0.95, 0]}>
              <sphereGeometry args={[1.12, 10, 10]} />
              <meshStandardMaterial color="#4b5563" roughness={0.82} metalness={0.16} />
            </mesh>
          ) : (
            <mesh ref={hairRef} position={[0, 0.72, -0.08]}>
              <sphereGeometry args={[1.06, 8, 8]} />
              <meshStandardMaterial color={hairColor} roughness={0.92} />
            </mesh>
          )}
        </group>
        <group ref={leftArmRef} position={[-1.35, 9, 0]}>
          <mesh position={[0, -0.35, 0]}>
            <capsuleGeometry args={[0.28, 2.4, 3, 6]} />
            <meshStandardMaterial color={clothColor} roughness={0.88} />
          </mesh>
        </group>
        <group ref={rightArmRef} position={[1.35, 9, 0]}>
          <mesh position={[0, -0.35, 0]}>
            <capsuleGeometry args={[0.28, 2.4, 3, 6]} />
            <meshStandardMaterial color={clothColor} roughness={0.88} />
          </mesh>
          {isSoldier && (
            <mesh position={[-0.32, -1.2, 0.34]} rotation={[0.05, 0.08, -Math.PI / 2]}>
              <boxGeometry args={[2.6, 0.16, 0.2]} />
              <meshStandardMaterial color="#111827" roughness={0.72} metalness={0.2} />
            </mesh>
          )}
        </group>
        <group ref={leftLegRef} position={[-0.52, 4.6, 0]}>
          <mesh position={[0, -0.1, 0.05]}>
            <capsuleGeometry args={[0.34, 3.2, 3, 6]} />
            <meshStandardMaterial color="#3d2914" roughness={0.9} />
          </mesh>
        </group>
        <group ref={rightLegRef} position={[0.52, 4.6, 0]}>
          <mesh position={[0, -0.1, 0.05]}>
            <capsuleGeometry args={[0.34, 3.2, 3, 6]} />
            <meshStandardMaterial color="#3d2914" roughness={0.9} />
          </mesh>
        </group>
        <mesh ref={repairBeamRef} visible={false} position={[0, 10.6, 0]} renderOrder={4}>
          <boxGeometry args={[18, 0.45, 0.45]} />
          <meshBasicMaterial color="#5eead4" transparent opacity={0.45} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh ref={repairSparkRef} visible={false} position={[0, 10.6, 0]} renderOrder={5}>
          <sphereGeometry args={[0.9, 6, 6]} />
          <meshBasicMaterial color="#facc15" transparent opacity={0.7} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    );
  }
  
  return (
    <group ref={group} position={[p.x, 0, p.z]} scale={[p.scale, p.scale, p.scale]}>
      {p.selected && (
        <group position={[0, 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
          <mesh>
            <ringGeometry args={[9.4, 10.9, ringSegments]} />
            <meshBasicMaterial color={p.weaponType === 'engineer' ? '#2dd4bf' : '#86efac'} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh>
            <circleGeometry args={[1.5, 18]} />
            <meshBasicMaterial color="#d9f99d" transparent opacity={0.8} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      )}
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
        {renderFullDetails && (
          <mesh position={[0.5, -0.5, 0.71]}>
            <circleGeometry args={[0.3, 8]} />
            <meshStandardMaterial 
              color="#2a1f1a"
              roughness={1}
              transparent
              opacity={0.6}
            />
          </mesh>
        )}
        
        {/* Torn fabric edges */}
        {renderFullDetails && (
          <mesh position={[-1.1, 0, 0]} rotation={[0, Math.PI/2, 0]}>
            <planeGeometry args={[1.4, 3]} />
            <meshStandardMaterial 
              color={clothColor}
              roughness={1}
              side={THREE.DoubleSide}
            />
          </mesh>
        )}
        {isSoldier && (
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
          <sphereGeometry args={[0.15, eyeSegments, eyeSegments]} />
          <meshStandardMaterial color="#f5f5dc" />
        </mesh>
        <mesh position={[0.35, 0.1, 0.9]}>
          <sphereGeometry args={[0.15, eyeSegments, eyeSegments]} />
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
        {renderFullDetails && hasScars && (
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
        {renderFullDetails && (
          <mesh position={[-0.3, -0.2, 0.95]}>
            <circleGeometry args={[0.2, 6]} />
            <meshStandardMaterial 
              color="#3d2914"
              roughness={1}
              transparent
              opacity={0.4}
            />
          </mesh>
        )}
        
        {/* Beard stubble */}
        {renderFullDetails && hasBeard && (
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
            <sphereGeometry args={[1.15, hairSegments, hairSegments]} />
            <meshStandardMaterial 
              color={hairColor}
              roughness={0.9}
            />
          </mesh>
          
          {/* Messy hair strands */}
          {hairStrands.map((strand) => (
            <mesh 
              key={strand.key}
              position={strand.position}
              rotation={strand.rotation}
            >
              <capsuleGeometry args={[0.08, 0.4, 3, renderFullDetails ? 8 : 6]} />
              <meshStandardMaterial 
                color={hairColor}
                roughness={0.95}
              />
            </mesh>
          ))}
        </group>
        
        {/* Goggles / eyewear */}
        {renderFullDetails && hasGoggles && (
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
        {renderFullDetails && hasMask && (
          <mesh position={[0, -0.2, 1.1]}>
            <boxGeometry args={[0.8, 0.6, 0.4]} />
            <meshStandardMaterial 
              color="#2a2a2a"
              metalness={0.2}
              roughness={0.6}
            />
          </mesh>
        )}
        {isSoldier && (
          <>
            <mesh position={[0, 1.1, -0.05]}>
              <sphereGeometry args={[1.22, headSegments, headSegments]} />
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
          <capsuleGeometry args={[0.35, 1.5, 4, limbRadialSegments]} />
          <meshStandardMaterial 
            color={clothColor}
            roughness={0.9}
          />
        </mesh>
        
        {/* Lower arm */}
        <mesh position={[0, -0.8, 0]}>
          <capsuleGeometry args={[0.3, 1.3, 4, limbRadialSegments]} />
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
          <capsuleGeometry args={[0.35, 1.5, 4, limbRadialSegments]} />
          <meshStandardMaterial 
            color={clothColor}
            roughness={0.9}
          />
        </mesh>
        
        <mesh position={[0, -0.8, 0]}>
          <capsuleGeometry args={[0.3, 1.3, 4, limbRadialSegments]} />
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
        {renderFullDetails && hasArmor && (
          <mesh position={[0, -0.8, 0.35]}>
            <boxGeometry args={[0.35, 1, 0.15]} />
            <meshStandardMaterial 
              color="#4a4a4a"
              metalness={0.6}
              roughness={0.4}
            />
          </mesh>
        )}
        {isSoldier && (
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
          <capsuleGeometry args={[0.45, 1.8, 4, limbRadialSegments]} />
          <meshStandardMaterial 
            color="#3d2914"
            roughness={0.9}
          />
        </mesh>
        
        {/* Calf */}
        <mesh position={[0, -0.8, 0]}>
          <capsuleGeometry args={[0.4, 1.6, 4, limbRadialSegments]} />
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
        {renderFullDetails && (
          <mesh position={[0, 0.2, 0.45]}>
            <boxGeometry args={[0.5, 0.4, 0.15]} />
            <meshStandardMaterial 
              color="#2a2a2a"
              roughness={0.7}
            />
          </mesh>
        )}
      </group>
      
      <group ref={rightLegRef} position={[0.6, 4.5, 0]}>
        <mesh position={[0, 1, 0]}>
          <capsuleGeometry args={[0.45, 1.8, 4, limbRadialSegments]} />
          <meshStandardMaterial 
            color="#3d2914"
            roughness={0.9}
          />
        </mesh>
        
        <mesh position={[0, -0.8, 0]}>
          <capsuleGeometry args={[0.4, 1.6, 4, limbRadialSegments]} />
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
        {renderMediumDetails && hasBackpack && (
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
        {renderFullDetails && (
          <>
            <mesh position={[-0.7, -1, 0.3]}>
              <boxGeometry args={[0.4, 0.5, 0.25]} />
              <meshStandardMaterial color="#3d2914" />
            </mesh>
            <mesh position={[0.7, -1, 0.3]}>
              <boxGeometry args={[0.4, 0.5, 0.25]} />
              <meshStandardMaterial color="#3d2914" />
            </mesh>
          </>
        )}
        
        {/* Shoulder strap */}
        {renderFullDetails && (
          <mesh position={[0.9, 1, 0]} rotation={[0, 0, 0.3]}>
            <boxGeometry args={[0.15, 3, 0.05]} />
            <meshStandardMaterial color="#2a1f14" />
          </mesh>
        )}
        
        {/* Canteen */}
        {renderFullDetails && (
          <mesh position={[0.85, -0.5, 0.4]}>
            <cylinderGeometry args={[0.15, 0.12, 0.5, 8]} />
            <meshStandardMaterial 
              color="#556b2f"
              metalness={0.1}
              roughness={0.7}
            />
          </mesh>
        )}
      </group>
      
      {/* === IMPROVISED ARMOR === */}
      {renderFullDetails && hasArmor && (
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
      {renderFullDetails && (p.vx || p.vz) && Math.random() < 0.1 && (
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
  const frameSkip = useRef(0);
  
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
       frameSkip.current = (frameSkip.current + 1) % 2;
       if (frameSkip.current === 0) {
         const t0 = state.clock.elapsedTime;
         smokeMeshes.current.forEach((sm, i) => {
            if (!sm) return;
            sm.visible = true;
            const t = (t0 * 1.2 + i * 0.9) % 2.8;
            sm.position.y = 4 + t * 7;
            sm.scale.setScalar(0.5 + t * 0.55);
            if (sm.material) sm.material.opacity = Math.max(0, 0.42 - t * 0.12);
         });
       }
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

const EntityTank = memo(({ entityId, entityLookupRef, index, entitiesRef, frameSnapshotRef }) => {
  const group = useRef();
  const modelNodesRef = useRef({});
  const fireAnim = useRef(0);
  const soundCooldown = useRef(0);
  const selectionFlashRef = useRef();
  const selectionBeamRef = useRef();
  const smokeMeshes = useRef([]);
  const smokeOffsetsRef = useRef(
    Array.from({ length: 4 }, (_, smokeIndex) => ({
      x: (Math.random() - 0.5) * 6,
      y: 5 + smokeIndex * 0.5,
      z: (Math.random() - 0.5) * 5,
      speed: 0.8 + Math.random() * 0.45,
      scale: 0.85 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2
    }))
  );
  const materialStatesRef = useRef([]);
  const wasBroken = useRef(false);
  const initialTank = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  const tankAssetName = initialTank?.variant === 'apc' ? 'battle_apc' : 'battle_tank';
  const [assetReady, setAssetReady] = useState(Boolean(airstrikeAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(airstrikeAssetCache.error));

  const registerArmorMaterial = (material) => {
    if (!material || materialStatesRef.current.some((entry) => entry.material === material)) return;
    materialStatesRef.current.push({
      material,
      color: material.color?.clone?.() || null,
      emissive: material.emissive?.clone?.() || null,
      emissiveIntensity: material.emissiveIntensity ?? 0
    });
  };

  const tankScene = useMemo(() => {
    const sourceScene = airstrikeAssetCache.scene;
    if (!assetReady || !sourceScene || !tankAssetName) return null;
    materialStatesRef.current = [];
    const clone = cloneNamedGlbGroup(sourceScene, tankAssetName);
    if (!clone) return null;
    clone.traverse((node) => {
      if (node.position && !node.userData.basePosition) node.userData.basePosition = node.position.clone();
      if (node.rotation && !node.userData.baseRotation) node.userData.baseRotation = node.rotation.clone();
      if (node.scale && !node.userData.baseScale) node.userData.baseScale = node.scale.clone();
      if (!node.isMesh) return;
      if (Array.isArray(node.material)) node.material.forEach(registerArmorMaterial);
      else registerArmorMaterial(node.material);
    });
    modelNodesRef.current = clone.userData?.namedNodes || {};
    return clone;
  }, [assetReady, tankAssetName]);

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

  useEffect(() => () => disposeClonedMaterials(tankScene), [tankScene]);

  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) {
      if (group.current) group.current.visible = false;
      return;
    }
    if (!group.current) return;

    const ds = getFrameScaledStep(delta);
    const time = state.clock.elapsedTime;
    const armorVisualMultiplier = p.variant === 'apc' ? APC_VISUAL_SCALE_MULTIPLIER : TANK_VISUAL_SCALE_MULTIPLIER;
    const armorScale = GROUND_ARMOR_MODEL_SCALE * (p.scale || 1) * armorVisualMultiplier;
    const isBroken = p.state === 'broken';
    const turretRoot = modelNodesRef.current.vehicle_turret_root;
    const barrelNode = modelNodesRef.current.vehicle_barrel;
    const shroudNode = modelNodesRef.current.vehicle_barrel_shroud;
    const muzzleGlow = modelNodesRef.current.vehicle_muzzle_glow;
    const sensorGlow = modelNodesRef.current.vehicle_sensor_glow;
    const groundKaijus = frameSnapshotRef?.current?.ready
      ? frameSnapshotRef.current.groundKaijus
      : entitiesRef.current.filter((entity) => (
          entity.type === 'kaiju' && !isKaijuDefeated(entity) && !isFlyingKaiju(entity)
        ));
    const allBunkers = frameSnapshotRef?.current?.ready
      ? frameSnapshotRef.current.allBunkers
      : entitiesRef.current.filter(e => e.type === 'bunker' && !e.dead);
    const liveFacilities = frameSnapshotRef?.current?.ready
      ? frameSnapshotRef.current.liveFacilities
      : entitiesRef.current.filter(e => e.type === 'facility' && !e.dead);

    soundCooldown.current = Math.max(0, soundCooldown.current - delta);
    fireAnim.current = Math.max(0, fireAnim.current - delta * 4.8);

    if (isBroken !== wasBroken.current) {
      wasBroken.current = isBroken;
      materialStatesRef.current.forEach(({ material, color, emissive, emissiveIntensity }) => {
        if (!material) return;
        if (isBroken) {
          if (material.color) material.color.set('#1a1a1a');
          if (material.emissive) {
            material.emissive.set('#2b1204');
            material.emissiveIntensity = 0.28;
          }
        } else {
          if (material.color && color) material.color.copy(color);
          if (material.emissive && emissive) {
            material.emissive.copy(emissive);
            material.emissiveIntensity = emissiveIntensity;
          }
        }
      });
    }

    p.reloadTimer = Math.max(0, (p.reloadTimer || 0) - delta);
    p.vx = p.vx || 0;
    p.vz = p.vz || 0;
    p.y = getTerrainHeight(p.x, p.z);
    p.targetDist = p.targetDist || (p.variant === 'apc' ? 170 + Math.random() * 90 : 185 + Math.random() * 105);
    p.orbitOffset = p.orbitOffset || ((Math.random() - 0.5) * 0.9);

    const initialHeading = p.vx || p.vz ? -Math.atan2(p.vz, p.vx) : (p.rotation ?? 0);
    p.renderHullYaw = p.renderHullYaw ?? initialHeading;
    p.renderTurretWorldYaw = p.renderTurretWorldYaw ?? p.renderHullYaw;
    p.renderBank = p.renderBank ?? 0;
    p.renderBob = p.renderBob ?? 0;

    let desiredHullYaw = p.renderHullYaw;
    let desiredTurretWorldYaw = p.renderTurretWorldYaw;
    let moving = false;
    let nearestKaiju = null;
    let minDist = Infinity;
    let followCommand = false;

    const isAttackMove = p.orderType === 'attack_move';
    const moveTargetX = (p.orderType === 'move' || isAttackMove) ? p.orderX : p.commandTargetX;
    const moveTargetZ = (p.orderType === 'move' || isAttackMove) ? p.orderZ : p.commandTargetZ;
    const attackTarget = p.orderType === 'attack' ? entityLookupRef?.current?.get?.(p.orderTargetId) : null;

    if (!isBroken && moveTargetX !== undefined && moveTargetZ !== undefined) {
      let nearbyAttackMoveKaiju = null;
      if (isAttackMove) {
        groundKaijus.forEach((candidate) => {
          if (!candidate || isKaijuDefeated(candidate)) return;
          const dist = Math.hypot(candidate.x - p.x, candidate.z - p.z);
          if (dist <= p.targetDist + 110 && (!nearbyAttackMoveKaiju || dist < nearbyAttackMoveKaiju.dist)) {
            nearbyAttackMoveKaiju = { entity: candidate, dist };
          }
        });
      }
      const cmdDx = moveTargetX - p.x;
      const cmdDz = moveTargetZ - p.z;
      const cmdDist = Math.hypot(cmdDx, cmdDz);
      if (cmdDist > 16 && !nearbyAttackMoveKaiju) {
        const commandHeading = Math.atan2(cmdDz, cmdDx);
        const speed = (p.variant === 'apc' ? 3.35 : 3.05) * Math.max(0.7, p.speedMultiplier || 1) * TANK_MOVE_SPEED_MULTIPLIER;
        p.vx = Math.cos(commandHeading) * speed;
        p.vz = Math.sin(commandHeading) * speed;

        // Structure avoidance for tanks
        allBunkers.forEach(b => {
          const bdx = p.x - b.x;
          const bdz = p.z - b.z;
          const bd = Math.hypot(bdx, bdz);
          if (bd < 52) {
             const push = (52 - bd) / 52;
             p.x += (bdx / Math.max(0.1, bd)) * push * 5;
             p.z += (bdz / Math.max(0.1, bd)) * push * 5;
          }
        });
        liveFacilities.forEach(f => {
          const fdx = p.x - f.x;
          const fdz = p.z - f.z;
          const fd = Math.hypot(fdx, fdz);
          const radius = 58 * (f.visualScale || 1);
          if (fd < radius) {
            const push = (radius - fd) / radius;
            p.x += (fdx / Math.max(1, fd)) * push * 5;
            p.z += (fdz / Math.max(1, fd)) * push * 5;
          }
        });

        desiredHullYaw = -commandHeading;
        desiredTurretWorldYaw = desiredHullYaw;
        p.state = 'driving';
        moving = true;
        followCommand = true;
      } else {
        if (!isAttackMove || cmdDist <= 16) clearUnitOrder(p);
      }
    }

    if (!followCommand && attackTarget && !isKaijuDefeated(attackTarget) && !isFlyingKaiju(attackTarget)) {
      nearestKaiju = attackTarget;
      minDist = Math.hypot((attackTarget.x || 0) - p.x, (attackTarget.z || 0) - p.z);
    } else if (!followCommand && (isAttackMove || !p.orderType)) {
      groundKaijus.forEach((candidate) => {
        if (!candidate || isKaijuDefeated(candidate)) return;
        const dist = Math.hypot(candidate.x - p.x, candidate.z - p.z);
        if (dist < minDist) {
          minDist = dist;
          nearestKaiju = candidate;
        }
      });
    }

    if (nearestKaiju && (p.orderType === 'attack' || isAttackMove || !p.orderType)) {
      const dx = nearestKaiju.x - p.x;
      const dz = nearestKaiju.z - p.z;
      const angleToKaiju = Math.atan2(dz, dx);
      desiredTurretWorldYaw = -angleToKaiju;

      if (!isBroken && minDist < p.targetDist - 32) {
        const retreatHeading = angleToKaiju + Math.PI + p.orbitOffset * 0.4;
        const reverseSpeed = (p.variant === 'apc' ? 1.55 : 1.2) * Math.max(0.72, p.speedMultiplier || 1) * TANK_MOVE_SPEED_MULTIPLIER;
        p.vx = Math.cos(retreatHeading) * reverseSpeed;
        p.vz = Math.sin(retreatHeading) * reverseSpeed;
        desiredHullYaw = -retreatHeading;
        moving = true;
        p.state = 'driving';
      } else if (!isBroken && minDist > p.targetDist + 38) {
        const approachHeading = angleToKaiju + p.orbitOffset * 0.18;
        const advanceSpeed = (p.variant === 'apc' ? 3.05 : 2.7) * Math.max(0.72, p.speedMultiplier || 1) * TANK_MOVE_SPEED_MULTIPLIER;
        p.vx = Math.cos(approachHeading) * advanceSpeed;
        p.vz = Math.sin(approachHeading) * advanceSpeed;
        desiredHullYaw = -approachHeading;
        moving = true;
        p.state = 'driving';
      } else {
        p.vx = THREE.MathUtils.damp(p.vx, 0, 7, delta);
        p.vz = THREE.MathUtils.damp(p.vz, 0, 7, delta);
        desiredHullYaw = desiredTurretWorldYaw;
        p.state = 'holding';
      }

      const reloadScale = Math.max(0.2, p.reloadMultiplier || 1);
      const reloadTime = (p.variant === 'apc' ? 1.25 + Math.random() * 0.7 : 1.8 + Math.random() * 0.85) / reloadScale;
      const turretError = Math.abs(wrapAngle(desiredTurretWorldYaw - p.renderTurretWorldYaw));
      if (!isBroken && p.reloadTimer <= 0 && minDist < p.targetDist + 96 && turretError < 0.18) {
        const muzzleWorldYaw = p.renderTurretWorldYaw;
        const forwardX = Math.cos(muzzleWorldYaw);
        const forwardZ = -Math.sin(muzzleWorldYaw);
        const muzzleReach = (p.variant === 'apc' ? 11.5 : 14.6) * (p.scale || 1);
        const muzzleHeight = (p.variant === 'apc' ? 6.4 : 7.6) * (p.scale || 1);
        const muzzleX = p.x + forwardX * muzzleReach;
        const muzzleZ = p.z + forwardZ * muzzleReach;

        p.reloadTimer = reloadTime;
        AudioManager.play('tank_fire', { volume: p.variant === 'apc' ? 0.17 : 0.23 });
        nearestKaiju.hp -= TANK_SHELL_DAMAGE * Math.max(p.variant === 'apc' ? 0.76 : 0.9, p.damageMultiplier || 1);
        if (nearestKaiju.hp <= 0) markKaijuDefeated(nearestKaiju);

        entitiesRef.current.push({
          id: `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'shell',
          x: muzzleX,
          y: (p.y || 0) + muzzleHeight,
          z: muzzleZ,
          targetX: nearestKaiju.x,
          targetY: (nearestKaiju.y || 0) + 40,
          targetZ: nearestKaiju.z,
          age: 0,
          dead: false
        });
        entitiesRef.current.push({
          id: `muzzleflash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'muzzle_flash',
          x: muzzleX,
          y: (p.y || 0) + muzzleHeight,
          z: muzzleZ,
          age: 0,
          dead: false
        });
        fireAnim.current = 1;
      }
    } else {
      p.vx = THREE.MathUtils.damp(p.vx, 0, 5, delta);
      p.vz = THREE.MathUtils.damp(p.vz, 0, 5, delta);
      if (Math.abs(p.vx) < 0.06) p.vx = 0;
      if (Math.abs(p.vz) < 0.06) p.vz = 0;
      if (p.orderType === 'attack' && (!attackTarget || isKaijuDefeated(attackTarget) || isFlyingKaiju(attackTarget))) {
        clearUnitOrder(p);
      }
      p.state = isBroken ? 'broken' : (p.orderType === 'hold' ? 'holding' : 'idle');
    }

    if (!isBroken) {
      p.x += p.vx * ds;
      p.z += p.vz * ds;
      p.y = getTerrainHeight(p.x, p.z);
    }

    const speed = Math.hypot(p.vx, p.vz);
    const targetBank = THREE.MathUtils.clamp(wrapAngle(desiredHullYaw - p.renderHullYaw) * 0.12, -0.06, 0.06) + (isBroken ? -0.12 : 0);
    const targetBob = !isBroken && speed > 0.18
      ? Math.sin(time * (p.variant === 'apc' ? 16 : 13.5) + (p.orbitOffset || 0) * 4) * Math.min(0.22, speed * 0.045)
      : 0;
    p.renderHullYaw = dampAngle(p.renderHullYaw, desiredHullYaw, moving ? TANK_HULL_TURN_RATE : TANK_IDLE_TURN_RATE, delta);
    p.renderTurretWorldYaw = dampAngle(p.renderTurretWorldYaw, desiredTurretWorldYaw, TANK_TURRET_TURN_RATE, delta);
    p.renderTurretYaw = wrapAngle(p.renderTurretWorldYaw - p.renderHullYaw);
    p.renderBank = THREE.MathUtils.lerp(p.renderBank, targetBank, Math.min(1, delta * 4.2));
    p.renderBob = THREE.MathUtils.lerp(p.renderBob, targetBob, Math.min(1, delta * 6));
    p.rotation = p.renderHullYaw;

    group.current.position.set(p.x, (p.y || 0) + p.renderBob, p.z);
    group.current.rotation.set(0, p.renderHullYaw, p.renderBank);
    group.current.visible = true;

    if (turretRoot) {
      turretRoot.rotation.y = p.renderTurretYaw;
      turretRoot.rotation.x = isBroken ? 0.07 : 0;
    }
    [barrelNode, shroudNode, muzzleGlow].forEach((node, nodeIndex) => {
      if (!node?.userData?.basePosition) return;
      node.position.copy(node.userData.basePosition);
      node.position.x -= fireAnim.current * (nodeIndex === 0 ? TANK_MODEL_RECOIL_DISTANCE : TANK_MODEL_RECOIL_DISTANCE * 0.72);
    });
    if (muzzleGlow) {
      setCloudOpacity(muzzleGlow, isBroken ? 0.06 : 0.08 + fireAnim.current * 0.5);
      const pulse = 1 + fireAnim.current * 0.6;
      if (muzzleGlow.userData.baseScale) {
        muzzleGlow.scale.set(
          muzzleGlow.userData.baseScale.x * pulse,
          muzzleGlow.userData.baseScale.y * pulse,
          muzzleGlow.userData.baseScale.z * pulse
        );
      }
    }
    if (sensorGlow) {
      setCloudOpacity(
        sensorGlow,
        isBroken
          ? 0.05
          : 0.12 + (nearestKaiju ? 0.12 : 0) + Math.sin(time * 4.5 + (p.orbitOffset || 0)) * 0.03
      );
    }
    [0, 1].forEach((glowIndex) => {
      const exhaustGlow = modelNodesRef.current[`vehicle_exhaust_glow_${glowIndex}`];
      if (!exhaustGlow) return;
      setCloudOpacity(
        exhaustGlow,
        isBroken
          ? 0.08 + Math.sin(time * 3 + glowIndex) * 0.02
          : 0.09 + Math.min(0.22, speed * 0.05) + Math.sin(time * 8 + glowIndex * 1.5) * 0.04
      );
    });

    smokeMeshes.current.forEach((mesh, smokeIndex) => {
      if (!mesh) return;
      if (!isBroken) {
        mesh.visible = false;
        return;
      }
      const smokeProfile = smokeOffsetsRef.current[smokeIndex];
      const loop = (time * smokeProfile.speed + smokeProfile.phase) % 3.2;
      mesh.visible = true;
      mesh.position.set(
        smokeProfile.x + Math.sin(time * 0.6 + smokeProfile.phase) * 0.8,
        smokeProfile.y + loop * 3.8,
        smokeProfile.z + Math.cos(time * 0.55 + smokeProfile.phase) * 0.6
      );
      mesh.scale.setScalar(smokeProfile.scale + loop * 0.4);
      if (mesh.material) mesh.material.opacity = Math.max(0, 0.42 - loop * 0.1);
    });

    if (!isBroken && speed > 0.28 && soundCooldown.current <= 0) {
      AudioManager.play('tank_engine', {
        volume: p.variant === 'apc' ? 0.034 + speed * 0.004 : 0.04 + speed * 0.004,
        duration: 0.3
      });
      soundCooldown.current = p.variant === 'apc' ? 0.34 : 0.42;
    }

    group.current.scale.setScalar(armorScale);

    if (selectionFlashRef.current && selectionBeamRef.current) {
      const remainingPulse = (p.selectionPulseUntil || 0) - Date.now();
      const pulsing = remainingPulse > 0;
      selectionFlashRef.current.visible = pulsing;
      selectionBeamRef.current.visible = pulsing;
      if (pulsing) {
        const progress = 1 - Math.max(0, remainingPulse / 1000);
        selectionFlashRef.current.scale.setScalar(1 + progress * 2.2);
        selectionFlashRef.current.material.opacity = (1 - progress) * 0.88;
        selectionBeamRef.current.position.y = 12 + progress * 32;
        selectionBeamRef.current.scale.set(1 + progress * 0.8, 1, 1 + progress * 0.8);
        selectionBeamRef.current.material.opacity = Math.pow(1 - progress, 1.4) * 0.48;
      }
    }
  });

  const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  if (!p || p.dead) return null;

  const registerFallbackMaterial = (material) => {
    if (!material) return;
    registerArmorMaterial(material);
  };

  return (
    <group ref={group} position={[p.x, p.y || 0, p.z]} scale={[(GROUND_ARMOR_MODEL_SCALE * (p.scale || 1)) * (p.variant === 'apc' ? APC_VISUAL_SCALE_MULTIPLIER : TANK_VISUAL_SCALE_MULTIPLIER), (GROUND_ARMOR_MODEL_SCALE * (p.scale || 1)) * (p.variant === 'apc' ? APC_VISUAL_SCALE_MULTIPLIER : TANK_VISUAL_SCALE_MULTIPLIER), (GROUND_ARMOR_MODEL_SCALE * (p.scale || 1)) * (p.variant === 'apc' ? APC_VISUAL_SCALE_MULTIPLIER : TANK_VISUAL_SCALE_MULTIPLIER)]}>
      {p.selected && (
        <group position={[0, 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
          <mesh>
            <ringGeometry args={[18, 20.4, 28]} />
            <meshBasicMaterial color={p.variant === 'apc' ? '#67e8f9' : '#86efac'} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh>
            <circleGeometry args={[2.2, 20]} />
            <meshBasicMaterial color="#d9f99d" transparent opacity={0.78} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      )}
      <mesh ref={selectionFlashRef} visible={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]} renderOrder={7}>
        <ringGeometry args={[22, 26, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={selectionBeamRef} visible={false} position={[0, 12, 0]} renderOrder={6}>
        <cylinderGeometry args={[12, 18, 24, 16]} />
        <meshBasicMaterial color="#86efac" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {tankScene ? (
        <group position={[0, 0, 0]} rotation={[0, 0, 0]}>
          <primitive object={tankScene} />
        </group>
      ) : (
        <>
          <mesh position={[0, 9, 0]}>
            <boxGeometry args={[50, 14, 28]} />
            <meshStandardMaterial ref={registerFallbackMaterial} color={p.variant === 'apc' ? '#2f4f7f' : '#4b5d3a'} roughness={0.62} metalness={0.32} />
          </mesh>
          <mesh position={[8, 15.5, 0]} rotation={[0, 0, -0.2]}>
            <boxGeometry args={[20, 6.2, 24]} />
            <meshStandardMaterial ref={registerFallbackMaterial} color="#475569" roughness={0.5} metalness={0.42} />
          </mesh>
          <mesh position={[0, 3.8, 12]}>
            <boxGeometry args={[52, 6, 5.8]} />
            <meshStandardMaterial ref={registerFallbackMaterial} color="#161b22" roughness={0.84} metalness={0.18} />
          </mesh>
          <mesh position={[0, 3.8, -12]}>
            <boxGeometry args={[52, 6, 5.8]} />
            <meshStandardMaterial ref={registerFallbackMaterial} color="#161b22" roughness={0.84} metalness={0.18} />
          </mesh>
          <group position={[p.variant === 'apc' ? 4 : 2, p.variant === 'apc' ? 17 : 19, 0]}>
            <mesh>
              {p.variant === 'apc' ? <boxGeometry args={[20, 7, 16]} /> : <cylinderGeometry args={[9.5, 10.2, 8, 18]} />}
              <meshStandardMaterial ref={registerFallbackMaterial} color={p.variant === 'apc' ? '#26436b' : '#3f5332'} roughness={0.54} metalness={0.38} />
            </mesh>
            <mesh position={[p.variant === 'apc' ? 17 : 24, 0.6, 0]} rotation={[0, 0, -Math.PI / 2]}>
              <cylinderGeometry args={[p.variant === 'apc' ? 1.2 : 1.5, p.variant === 'apc' ? 1.4 : 1.8, p.variant === 'apc' ? 18 : 28, 12]} />
              <meshStandardMaterial ref={registerFallbackMaterial} color="#161b22" roughness={0.42} metalness={0.48} />
            </mesh>
          </group>
          {p.variant === 'apc' ? (
            <mesh position={[-6, 18, 0]}>
              <boxGeometry args={[24, 11, 20]} />
              <meshStandardMaterial ref={registerFallbackMaterial} color="#26436b" roughness={0.54} metalness={0.38} />
            </mesh>
          ) : null}
        </>
      )}
      {smokeOffsetsRef.current.map((offset, smokeIndex) => (
        <mesh
          key={`tank-smoke-${smokeIndex}`}
          visible={false}
          ref={(el) => { smokeMeshes.current[smokeIndex] = el; }}
          position={[offset.x, offset.y, offset.z]}
        >
          <sphereGeometry args={[1.9 + smokeIndex * 0.18, 8, 8]} />
          <meshBasicMaterial color="#2c2c2c" transparent opacity={0.35} />
        </mesh>
      ))}
    </group>
  );
});

const SOLDIER_ASSET_NAME_BY_WEAPON = {
  rifleman: 'unit_soldier_rifleman',
  marksman: 'unit_soldier_marksman',
  gunner: 'unit_soldier_gunner',
  rpg: 'unit_soldier_rpg',
  missile: 'unit_soldier_missile',
  engineer: 'unit_soldier_engineer'
};

const EntitySoldierGLB = memo(({ entityId, entityLookupRef, index, entitiesRef }) => {
  const group = useRef();
  const visualRef = useRef();
  const soldierRigRef = useRef(null);
  const repairBeamRef = useRef();
  const repairSparkRef = useRef();
  const muzzleFlashRef = useRef();
  const muzzleHaloRef = useRef();
  const selectionFlashRef = useRef();
  const selectionBeamRef = useRef();
  
  // Procedural Animation Refs
  const walkCycle = useRef(0);
  const frameSkip = useRef(0);
  const legLRef = useRef();
  const legRRef = useRef();
  const armLRef = useRef();
  const armRRef = useRef();
  const [assetReady, setAssetReady] = useState(Boolean(humanUnitsAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(humanUnitsAssetCache.error));
  const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  const assetName = SOLDIER_ASSET_NAME_BY_WEAPON[p?.weaponType || 'rifleman'] || 'unit_soldier_rifleman';

  const soldierScene = useMemo(() => {
    if (!assetReady || !humanUnitsAssetCache.scene) return null;
    return cloneNamedGlbGroup(humanUnitsAssetCache.scene, assetName);
  }, [assetReady, assetName]);

  useEffect(() => {
    let cancelled = false;
    if (!assetReady && !assetFailed) {
      loadHumanUnitsAsset()
        .then((scene) => {
          if (!cancelled && scene) setAssetReady(true);
          if (!cancelled && !scene) setAssetFailed(true);
        })
        .catch(() => {
          if (!cancelled) setAssetFailed(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [assetReady, assetFailed]);

  useEffect(() => () => disposeClonedMaterials(soldierScene), [soldierScene]);

  useEffect(() => {
    soldierRigRef.current = soldierScene ? buildSoldierAnimationRig(soldierScene) : null;
    return () => {
      soldierRigRef.current = null;
    };
  }, [soldierScene]);

  useFrame((state, delta) => {
    const current = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!current || current.dead) {
      if (group.current) group.current.visible = false;
      return;
    }
    if (!group.current) return;

    const speed = Math.hypot(current.vx || 0, current.vz || 0);
    const moving = speed > 0.04;
    const facingAngle = Number.isFinite(current.aimAngle)
      ? current.aimAngle
      : Math.atan2(current.vz || 0, current.vx || 0);
    const targetYaw = -facingAngle + Math.PI / 2;
    const bob = moving ? Math.sin(state.clock.elapsedTime * 7.2) * Math.min(1.2, speed * 0.22) : 0;
    const now = Date.now();
    const weaponReady = !!current.weaponEquipped;
    const equipping = !weaponReady && (current.weaponEquipUntil || 0) > now;
    const firing = (current.firePoseUntil || 0) > now;
    const flashing = (current.muzzleFlashUntil || 0) > now;
    const attackPose = firing || equipping || (current.state === 'attacking_kaiju' && weaponReady);
    const repairPose = current.weaponType === 'engineer' && current.state === 'repairing';
    const sway = moving ? Math.sin(state.clock.elapsedTime * 10.5) * Math.min(0.08, speed * 0.02) : 0;
    const recoil = firing ? Math.sin(state.clock.elapsedTime * 48) * 0.07 : 0;

    group.current.visible = true;
    group.current.position.set(current.x, (current.y || 0) + bob, current.z);
    group.current.rotation.y = dampAngle(group.current.rotation.y || 0, targetYaw, 7.5, delta);
    const posturePitch = attackPose ? 0.16 : current.state === 'repairing' ? 0.12 : 0;
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, posturePitch, Math.min(1, delta * 5));

    if (visualRef.current) {
      visualRef.current.rotation.x = THREE.MathUtils.lerp(
        visualRef.current.rotation.x,
        attackPose ? -0.08 + recoil : 0,
        Math.min(1, delta * 10)
      );
      visualRef.current.rotation.z = THREE.MathUtils.lerp(
        visualRef.current.rotation.z,
        sway + (firing ? 0.03 : 0),
        Math.min(1, delta * 8)
      );
      visualRef.current.position.z = THREE.MathUtils.lerp(
        visualRef.current.position.z,
        firing ? -0.9 : 0,
        Math.min(1, delta * 12)
      );
      visualRef.current.position.y = THREE.MathUtils.lerp(
        visualRef.current.position.y,
        attackPose ? 0.5 : 0,
        Math.min(1, delta * 8)
      );
      
      // Procedural Walk Animation for fallback meshes
      walkCycle.current += speed * 4.5 * delta * 60;
      const swing = moving ? Math.sin(walkCycle.current) * 0.6 : 0;
      const armSwing = moving ? Math.sin(walkCycle.current) * 0.45 : 0;
      
      if (legLRef.current) legLRef.current.rotation.x = swing;
      if (legRRef.current) legRRef.current.rotation.x = -swing;
      
      if (armLRef.current) armLRef.current.rotation.x = attackPose ? -1.2 : current.state === 'repairing' ? -0.8 : -armSwing;
      if (armRRef.current) armRRef.current.rotation.x = attackPose ? -1.2 : current.state === 'repairing' ? -0.8 : armSwing;
    }

    const rig = soldierRigRef.current;
    frameSkip.current = (frameSkip.current + 1) % 2;
    const skipRigAnim = frameSkip.current !== 0 && !firing && !flashing;
    if (rig) {
      const baseMoveSpeed = Math.max(0.1, (current.combatSpeed || 2.6) * SOLDIER_MOVE_SPEED_MULTIPLIER);
      const normalizedSpeed = THREE.MathUtils.clamp(speed / baseMoveSpeed, 0, 1.35);
      const locomotion = moving ? THREE.MathUtils.clamp(normalizedSpeed, 0, 1) : 0;
      const stepFrequency = moving ? THREE.MathUtils.lerp(5.2, 9.8, locomotion) : 1.5;
      walkCycle.current += delta * stepFrequency * (0.8 + normalizedSpeed * 0.55);

      if (!skipRigAnim) {
      const isRunning = locomotion > 0.72;
      const stride = Math.sin(walkCycle.current);
      const oppositeStride = Math.sin(walkCycle.current + Math.PI);
      const strideLift = Math.max(0, Math.sin(walkCycle.current - Math.PI * 0.15));
      const oppositeStrideLift = Math.max(0, Math.sin(walkCycle.current + Math.PI - Math.PI * 0.15));
      const bounce = Math.abs(Math.sin(walkCycle.current * 2));
      const idleBreath = Math.sin(state.clock.elapsedTime * 1.9) * 0.02;
      const movementAmount = locomotion * (attackPose ? 0.34 : repairPose ? 0.44 : 1);
      const legSwing = stride * (isRunning ? 0.78 : 0.56) * movementAmount;
      const armSwing = stride * (isRunning ? 0.52 : 0.34) * movementAmount;
      const torsoRise = bounce * (isRunning ? 0.65 : 0.42) * movementAmount;
      const torsoLean = attackPose ? -0.32 : repairPose ? -0.26 : -movementAmount * 0.08;
      const torsoRoll = attackPose ? 0 : stride * 0.03 * movementAmount;
      const weaponCarrier = rig.weapon || rig.tool;

      applyRigTransform(rig.legLeft, delta, {
        rotation: { x: legSwing, z: -stride * 0.03 * movementAmount },
        position: { y: strideLift * 0.18 * movementAmount, z: Math.max(0, legSwing) * 0.28 }
      }, 11);
      applyRigTransform(rig.legRight, delta, {
        rotation: { x: -legSwing, z: oppositeStride * 0.03 * movementAmount },
        position: { y: oppositeStrideLift * 0.18 * movementAmount, z: Math.max(0, -legSwing) * 0.28 }
      }, 11);
      applyRigTransform(rig.bootLeft, delta, {
        rotation: { x: -legSwing * 0.42, z: -stride * 0.02 * movementAmount },
        position: { y: strideLift * 0.1 * movementAmount, z: Math.max(0, legSwing) * 0.18 }
      }, 12);
      applyRigTransform(rig.bootRight, delta, {
        rotation: { x: legSwing * 0.42, z: oppositeStride * 0.02 * movementAmount },
        position: { y: oppositeStrideLift * 0.1 * movementAmount, z: Math.max(0, -legSwing) * 0.18 }
      }, 12);

      applyRigTransform(rig.torso, delta, {
        position: { y: torsoRise + idleBreath * 0.8, z: moving ? -movementAmount * 0.25 : 0 },
        rotation: { x: torsoLean + idleBreath, z: torsoRoll }
      }, 9);
      applyRigTransform(rig.vest, delta, {
        position: { y: torsoRise * 0.86 },
        rotation: { x: torsoLean * 0.72, z: torsoRoll * 0.8 }
      }, 9);
      applyRigTransform(rig.pack, delta, {
        position: { y: torsoRise * 0.7, z: moving ? -movementAmount * 0.16 : 0 },
        rotation: { x: -torsoLean * 0.24 + bounce * 0.05 * movementAmount, z: -torsoRoll * 0.7 }
      }, 8);
      applyRigTransform(rig.belt, delta, {
        position: { y: torsoRise * 0.55 },
        rotation: { z: torsoRoll * 1.1 }
      }, 8);

      // Weapon class drives arm pose + weapon raise offsets
      const wClass = (current.weaponType === 'rpg' || current.weaponType === 'missile')
        ? 'launcher'
        : current.weaponType === 'engineer'
          ? 'tool'
          : 'rifle';

      // Per-class aim poses (mirror values from Soldier.js getAimPoseByClass)
      const aimArmL = attackPose
        ? wClass === 'launcher' ? { x: -1.06 + (firing ? -0.06 : 0), y: 0.22, z: 0.54 }
          : wClass === 'tool'     ? { x: -0.88, y: 0.14, z: 0.24 }
          :                        { x: -1.02 + (firing ? -0.04 : 0), y: 0.18, z: 0.4 }
        : repairPose
          ? { x: -0.66 + bounce * 0.12, y: -0.06, z: 0.22 }
          : { x: -armSwing * 0.95, z: -stride * 0.05 * movementAmount };

      const aimArmR = attackPose
        ? wClass === 'launcher' ? { x: -1.04 + recoil * 0.38 + (firing ? -0.1 : 0), y: -0.14, z: -0.34 }
          : wClass === 'tool'     ? { x: -0.96 + stride * 0.16, y: -0.06, z: -0.18 }
          :                        { x: -1.08 + recoil * 0.45, y: -0.08, z: -0.28 }
        : repairPose
          ? { x: -0.88 + stride * 0.16, y: 0.14, z: -0.3 }
          : { x: armSwing * 0.82, z: stride * 0.05 * movementAmount };

      applyRigTransform(rig.armLeft, delta, { rotation: aimArmL, position: { y: torsoRise * 0.35 } }, 10);
      applyRigTransform(rig.armRight, delta, { rotation: aimArmR, position: { y: torsoRise * 0.28 } }, 10);
      applyRigTransform(rig.padLeft, delta, {
        rotation: { x: aimArmL.x * 0.6, z: (aimArmL.z || 0) * 0.8 },
        position: { y: torsoRise * 0.34 }
      }, 10);
      applyRigTransform(rig.padRight, delta, {
        rotation: { x: aimArmR.x * 0.6, z: (aimArmR.z || 0) * 0.8 },
        position: { y: torsoRise * 0.28 }
      }, 10);

      applyRigTransform(rig.head, delta, {
        position: { y: torsoRise * 0.5 + idleBreath * 0.9 },
        rotation: {
          x: attackPose ? -0.14 : -torsoLean * 0.35 - idleBreath * 0.4,
          y: attackPose ? 0 : (moving ? stride * 0.03 * movementAmount : 0)
        }
      }, 7);
      applyRigTransform(rig.helmet, delta, {
        position: { y: torsoRise * 0.48 + idleBreath * 0.8 },
        rotation: {
          x: attackPose ? -0.1 : -torsoLean * 0.3,
          y: attackPose ? 0 : (moving ? stride * 0.025 * movementAmount : 0)
        }
      }, 7);
      applyRigTransform(rig.visor, delta, {
        position: { y: torsoRise * 0.46 + idleBreath * 0.75 },
        rotation: { x: attackPose ? -0.08 : -torsoLean * 0.22 }
      }, 7);
      applyRigTransform(rig.neckWrap, delta, {
        position: { y: torsoRise * 0.43 + idleBreath * 0.4 },
        rotation: { x: attackPose ? -0.06 : -torsoLean * 0.18 }
      }, 7);

      // Weapon position/rotation – raised to proper aiming stance when attacking
      const aimWepPos = attackPose
        ? wClass === 'launcher' ? { x: -0.12, y: 0.85, z: -0.95 + (firing ? -0.35 : 0) }
          : wClass === 'tool'     ? { x:  0.08, y: 0.62, z: -0.7  }
          :                        { x:  0.05, y: 1.05, z: -1.1  + (firing ? -0.3  : 0) }
        : repairPose
          ? { x: 0, y: 0.22, z: 0 }
          : { x: 0, y: torsoRise * 0.18, z: moving ? stride * 0.1 * movementAmount : 0 };

      const aimWepRot = attackPose
        ? wClass === 'launcher' ? { x: -0.28 + (firing ? 0.18 : 0), y:  0.04, z: -0.06 }
          : wClass === 'tool'     ? { x: -0.18 + (firing ? 0.12 : 0), y:  0.06, z: -0.04 }
          :                        { x: -0.32 + recoil * 0.24,        y:  0.05, z: -0.05 }
        : repairPose
          ? { x: -0.22, y: 0, z: -0.18 }
          : { x: stride * 0.04 * movementAmount, y: 0, z: -stride * 0.04 * movementAmount };

      applyRigTransform(weaponCarrier, delta, { position: aimWepPos, rotation: aimWepRot }, 12);
      applyRigTransform(rig.toolCanister, delta, {
        rotation: { x: bounce * 0.05 * movementAmount, z: -stride * 0.05 * movementAmount },
        position: { y: torsoRise * 0.44 }
      }, 8);
      applyRigTransform(rig.torch, delta, {
        rotation: { x: repairPose ? -0.2 + bounce * 0.08 : stride * 0.08 * movementAmount, z: repairPose ? -0.24 : 0 },
        position: { y: torsoRise * 0.22, z: repairPose ? 0.18 : 0 }
      }, 10);
      } // end !skipRigAnim
    }

    if (muzzleFlashRef.current && muzzleHaloRef.current) {
      const flashScale = current.weaponType === 'missile' ? 1.8 : current.weaponType === 'rpg' ? 1.45 : current.weaponType === 'gunner' ? 1.2 : 1;
      const flashColor = current.weaponType === 'missile' ? '#fb923c' : current.weaponType === 'rpg' ? '#f97316' : '#fde68a';
      muzzleFlashRef.current.visible = flashing;
      muzzleHaloRef.current.visible = flashing;
      if (flashing) {
        const pulse = 0.9 + Math.sin(state.clock.elapsedTime * 64) * 0.22;
        muzzleFlashRef.current.scale.setScalar(flashScale * pulse);
        muzzleHaloRef.current.scale.set(flashScale * 1.8 * pulse, flashScale * 1.1 * pulse, flashScale * 1.8 * pulse);
        if (muzzleFlashRef.current.material) {
          muzzleFlashRef.current.material.color.set(flashColor);
          muzzleFlashRef.current.material.opacity = 0.72 + pulse * 0.16;
        }
        if (muzzleHaloRef.current.material) {
          muzzleHaloRef.current.material.color.set(flashColor);
          muzzleHaloRef.current.material.opacity = 0.28 + pulse * 0.12;
        }
      }
    }

    if (repairBeamRef.current && repairSparkRef.current) {
      const repairing = current.weaponType === 'engineer' && current.state === 'repairing' && Number.isFinite(current.repairTargetX) && Number.isFinite(current.repairTargetZ);
      repairBeamRef.current.visible = repairing;
      repairSparkRef.current.visible = repairing;
      if (repairing) {
        const dx = current.repairTargetX - current.x;
        const dz = current.repairTargetZ - current.z;
        const beamLength = Math.max(10, Math.hypot(dx, dz));
        const beamAngle = Math.atan2(dz, dx);
        const pulse = 0.82 + Math.sin(state.clock.elapsedTime * 18) * 0.18;
        repairBeamRef.current.rotation.z = -beamAngle;
        repairBeamRef.current.scale.set(beamLength / 20, pulse, pulse);
        repairBeamRef.current.position.set(dx * 0.5, 16.2, dz * 0.5);
        repairSparkRef.current.position.set(dx, 16.2, dz);
        repairSparkRef.current.scale.setScalar(0.95 + pulse * 0.6);
        if (repairBeamRef.current.material) repairBeamRef.current.material.opacity = 0.32 + pulse * 0.24;
        if (repairSparkRef.current.material) repairSparkRef.current.material.opacity = 0.38 + pulse * 0.28;
      }
    }

    if (selectionFlashRef.current && selectionBeamRef.current) {
      const pulseTime = (current.selectionPulseUntil || 0) - now;
      const pulsing = pulseTime > 0;
      selectionFlashRef.current.visible = pulsing;
      selectionBeamRef.current.visible = pulsing;
      if (pulsing) {
        const progress = 1 - Math.max(0, pulseTime / 1000);
        selectionFlashRef.current.scale.setScalar(1 + progress * 2.8);
        selectionFlashRef.current.material.opacity = (1 - progress) * 0.82;
        selectionBeamRef.current.position.y = 8 + progress * 24;
        selectionBeamRef.current.scale.set(1 + progress * 0.5, 1, 1 + progress * 0.5);
        selectionBeamRef.current.material.opacity = Math.pow(1 - progress, 1.5) * 0.44;
      }
    }
  });

  if (!p || p.dead) return null;

  return (
    <group ref={group} position={[p.x, p.y || 0, p.z]} scale={[SOLDIER_MODEL_SCALE * (p.scale || 1), SOLDIER_MODEL_SCALE * (p.scale || 1), SOLDIER_MODEL_SCALE * (p.scale || 1)]}>
      {p.selected && (
        <group position={[0, 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
          <mesh>
            <ringGeometry args={[13, 15, 28]} />
            <meshBasicMaterial color={p.weaponType === 'engineer' ? '#2dd4bf' : '#86efac'} transparent opacity={0.95} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh>
            <circleGeometry args={[2.2, 18]} />
            <meshBasicMaterial color="#d9f99d" transparent opacity={0.84} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      )}
      <group ref={visualRef}>
        {soldierScene ? (
          <primitive object={soldierScene} />
        ) : (
          <group position={[0, 9, 0]}>
            {/* Torso */}
            <mesh position={[0, 4, 0]}>
              <boxGeometry args={[6, 8, 4]} />
              <AliveMaterial color={p.weaponType === 'engineer' ? '#0f766e' : '#4b5563'} roughness={0.86} metalness={0.08} />
            </mesh>
            {/* Backpack / Gear */}
            <mesh position={[0, 4, -3]}>
              <boxGeometry args={[5, 6, 3]} />
              <AliveMaterial color="#374151" roughness={0.9} />
            </mesh>
            {/* Head */}
            <mesh position={[0, 9.5, 0]}>
              <sphereGeometry args={[2.5, 12, 12]} />
              <AliveMaterial color="#c68642" roughness={0.72} />
            </mesh>
            {/* Combat Helmet */}
            <mesh position={[0, 10.2, 0]} rotation={[0.1, 0, 0]}>
              <cylinderGeometry args={[2.8, 2.8, 2.5, 12]} />
              <AliveMaterial color="#374151" roughness={0.78} metalness={0.18} />
            </mesh>

            {/* Left Arm (Pivot from shoulder) */}
            <group ref={armLRef} position={[-4, 7, 0]}>
              <mesh position={[0, -3.5, 0]}>
                <boxGeometry args={[2, 7, 2.5]} />
                <AliveMaterial color="#4b5563" />
              </mesh>
            </group>
            
            {/* Right Arm */}
            <group ref={armRRef} position={[4, 7, 0]}>
              <mesh position={[0, -3.5, 0]}>
                <boxGeometry args={[2, 7, 2.5]} />
                <AliveMaterial color="#4b5563" />
              </mesh>
              {/* Fallback Weapon attached to Right Arm */}
              <mesh position={[0, -5, 4]}>
                <boxGeometry args={[1, 1, 8]} />
                <AliveMaterial color="#111827" roughness={0.5} />
              </mesh>
            </group>

            {/* Left Leg (Pivot from hip) */}
            <group ref={legLRef} position={[-1.6, 0, 0]}>
              <mesh position={[0, -4.5, 0]}>
                <boxGeometry args={[2.4, 9, 2.4]} />
                <AliveMaterial color={p.weaponType === 'engineer' ? '#115e59' : '#1f2937'} />
              </mesh>
            </group>
            
            {/* Right Leg */}
            <group ref={legRRef} position={[1.6, 0, 0]}>
              <mesh position={[0, -4.5, 0]}>
                <boxGeometry args={[2.4, 9, 2.4]} />
                <AliveMaterial color={p.weaponType === 'engineer' ? '#115e59' : '#1f2937'} />
              </mesh>
            </group>
          </group>
        )}
        <mesh ref={muzzleHaloRef} visible={false} position={[0, 15.2, 11.4]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
          <ringGeometry args={[1.2, 2.8, 16]} />
          <meshBasicMaterial color="#fde68a" transparent opacity={0.34} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh ref={muzzleFlashRef} visible={false} position={[0, 15.4, 12.6]} rotation={[0, 0, Math.PI / 2]} renderOrder={6}>
          <coneGeometry args={[1.3, 4.4, 8]} />
          <meshBasicMaterial color="#fde68a" transparent opacity={0.8} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={repairBeamRef} visible={false} position={[0, 16.2, 0]} renderOrder={4}>
        <boxGeometry args={[20, 0.52, 0.52]} />
        <meshBasicMaterial color="#5eead4" transparent opacity={0.45} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={repairSparkRef} visible={false} position={[0, 16.2, 0]} renderOrder={5}>
        <sphereGeometry args={[1.1, 8, 8]} />
        <meshBasicMaterial color="#facc15" transparent opacity={0.7} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={selectionFlashRef} visible={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.45, 0]} renderOrder={7}>
        <ringGeometry args={[14, 16, 24]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={selectionBeamRef} visible={false} position={[0, 8, 0]} renderOrder={6}>
        <cylinderGeometry args={[4.2, 6.8, 16, 12]} />
        <meshBasicMaterial color="#86efac" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
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
  const frameSkip = useRef(0);
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

  useFrame((state, delta) => {
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

      frameSkip.current = (frameSkip.current + 1) % 2;
      if (frameSkip.current === 0) {
        const t0 = state.clock.elapsedTime;
        smokeMeshes.current.forEach((sm, i) => {
          if (!sm) return;
          sm.visible = true;
          const t = (t0 * 0.9 + i * 0.8) % 3.4;
          sm.position.y = sm.userData.baseY + t * 6;
          sm.scale.setScalar(sm.userData.baseScale + t * 0.35);
          if (sm.material) sm.material.opacity = Math.max(0, 0.36 - t * 0.08);
        });
      }
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
          <group position={[0, 16, 0]}>
            {/* Main building block */}
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[26, 32, 26]} />
              <AliveMaterial color={entity.color} roughness={0.88} metalness={0.12} />
            </mesh>
            {/* Foundation rim */}
            <mesh position={[0, -14, 0]}>
              <boxGeometry args={[28, 4, 28]} />
              <AliveMaterial color="#2d2d2d" roughness={0.95} metalness={0.05} />
            </mesh>
            {/* Modern sloped roof */}
            <mesh position={[0, 20, 0]} rotation={[0, Math.PI / 4, 0]}>
              <cylinderGeometry args={[1, 24, 8, 4]} />
              <AliveMaterial color={entity.roofColor || '#1f2937'} roughness={0.7} metalness={0.4} />
            </mesh>
            {/* Windows (glowing) */}
            {[-6, 6].map((wx, i) => (
              <mesh key={`win-f-${i}`} position={[wx, 4, 13.2]}>
                <boxGeometry args={[6, 8, 0.5]} />
                <AliveMaterial color="#e0f2fe" emissive="#38bdf8" emissiveIntensity={0.6} roughness={0.2} metalness={0.8} />
              </mesh>
            ))}
            {[-6, 6].map((wx, i) => (
              <mesh key={`win-b-${i}`} position={[wx, 4, -13.2]}>
                <boxGeometry args={[6, 8, 0.5]} />
                <AliveMaterial color="#e0f2fe" emissive="#38bdf8" emissiveIntensity={0.6} roughness={0.2} metalness={0.8} />
              </mesh>
            ))}
            {/* Entrance door */}
            <mesh position={[0, -8, 13.5]}>
              <boxGeometry args={[8, 12, 1]} />
              <AliveMaterial color="#475569" roughness={0.6} metalness={0.5} />
            </mesh>
          </group>
        )}
      </group>

      <group ref={broken} scale={[entity.scale, entity.scale, entity.scale]}>
        {brokenModel ? (
          <primitive object={brokenModel} />
        ) : (
          <group position={[0, 12, 0]}>
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[26, 24, 26]} />
              <AliveMaterial color={entity.color} roughness={0.95} metalness={0.1} />
            </mesh>
            <mesh position={[0, 14, 0]} rotation={[0.2, 0.4, -0.1]}>
              <boxGeometry args={[28, 3, 16]} />
              <AliveMaterial color={entity.roofColor || '#1f2937'} roughness={0.8} metalness={0.3} />
            </mesh>
          </group>
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
      tree_trunk: entity.trunkColor || '#a66a3a',
      tree_root: '#704626',
      tree_branch: entity.trunkColor || '#a66a3a',
      tree_canopy: entity.canopyColor || entity.color || '#2f855a',
      tree_canopy_accent: entity.canopyAccent || entity.color || '#4ade80'
    }, {
      tree_canopy: 0.08,
      tree_canopy_accent: 0.14
    });
    return clone;
  }, [assetReady, isPine, entity?.trunkColor, entity?.canopyColor, entity?.canopyAccent, entity?.color]);

  const brokenModel = useMemo(() => {
    if (!assetReady || !worldPropsAssetCache.scene || !entity) return null;
    const clone = cloneNamedGlbGroup(worldPropsAssetCache.scene, isPine ? 'tree_broken_pine' : 'tree_broken_broadleaf');
    tintPropClone(clone, {
      tree_trunk: entity.trunkColor || '#8a542b',
      tree_fallen_trunk: entity.trunkColor || '#9b6236',
      tree_splinter: entity.trunkColor || '#a66a3a',
      tree_canopy: entity.canopyColor || entity.color || '#2f855a',
      tree_canopy_accent: entity.canopyAccent || entity.color || '#4ade80'
    }, {
      tree_canopy: 0.08,
      tree_canopy_accent: 0.14
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
    ? '#3d4f65'
    : p.variant === 'beetle'
    ? '#78350f'
    : p.variant === 'wyrm'
    ? '#14532d'
    : p.variant === 'spicie_bird'
    ? '#374151'
    : '#3f3f46';
  const glowTone = p.variant === 'octopus' ? '#a78bfa' : p.variant === 'spicie_bird' ? '#f59e0b' : '#fb923c';

  return (
    <group
      position={[p.x, (p.y || 0) + Math.max(1.5, scale * 0.12), p.z]}
      rotation={[p.deathTiltX ?? 0.18, p.deathYaw ?? p.rotation ?? 0, p.deathRollZ ?? Math.PI / 2.8]}
    >
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
  const frameSkip = useRef(0);

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
      if (!flame) { return; }
      const data = flameData[i];
      const active = flameFade > 0.02 && !!data;
      flame.visible = active;
    });

    frameSkip.current = (frameSkip.current + 1) % 2;
    if (frameSkip.current === 0) {
    flameRefs.current.forEach((flame, i) => {
      if (!flame || !flame.material) return;
      const data = flameData[i];
      if (!data || flameFade <= 0.02) return;
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
    } // end frameSkip
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
  const modelNodesRef = useRef({});
  const [assetReady, setAssetReady] = useState(Boolean(airstrikeAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(airstrikeAssetCache.error));

  const jetScene = useMemo(() => {
    if (!assetReady || !airstrikeAssetCache.scene) return null;
    const clone = cloneNamedGlbGroup(airstrikeAssetCache.scene, 'strike_jet');
    if (!clone) return null;
    clone.traverse((node) => {
      if (node.position && !node.userData.basePosition) node.userData.basePosition = node.position.clone();
      if (node.rotation && !node.userData.baseRotation) node.userData.baseRotation = node.rotation.clone();
      if (node.scale && !node.userData.baseScale) node.userData.baseScale = node.scale.clone();
    });
    modelNodesRef.current = clone.userData?.namedNodes || {};
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

  useEffect(() => () => disposeClonedMaterials(jetScene), [jetScene]);

  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) {
      if (group.current) group.current.visible = false;
      return;
    }
    if (!group.current) return;

    const time = state.clock.elapsedTime;
    const speed = Math.hypot(p.vx || 0, p.vz || 0);
    const targetYaw = -Math.atan2(p.vz || 0.001, p.vx || 0.001);
    const prevYaw = p.renderYaw ?? targetYaw;
    const yawDelta = wrapAngle(targetYaw - prevYaw);
    const previousY = p.renderPrevY ?? (p.y || 0);
    const verticalSpeed = ((p.y || 0) - previousY) / Math.max(delta, 0.001);

    p.renderPrevY = p.y || 0;
    p.renderYaw = prevYaw + yawDelta * Math.min(1, delta * 4.6);
    p.renderRoll = THREE.MathUtils.lerp(
      p.renderRoll ?? 0,
      THREE.MathUtils.clamp(yawDelta * 3.3, -0.7, 0.7) + (p.fired ? 0.08 : 0),
      Math.min(1, delta * 4.8)
    );
    p.renderPitch = THREE.MathUtils.lerp(
      p.renderPitch ?? 0,
      THREE.MathUtils.clamp(-verticalSpeed * 0.006, -0.18, 0.18) + Math.cos(time * 1.8 + (p.flightAge || 0)) * 0.02,
      Math.min(1, delta * 3.6)
    );

    group.current.position.set(p.x, p.y, p.z);
    group.current.rotation.y = p.renderYaw;
    group.current.rotation.x = p.renderPitch;
    group.current.rotation.z = p.renderRoll;
    group.current.visible = true;

    const burnerBoost = p.fired ? 0.16 : 0.08;
    ['jet_afterburner_left', 'jet_afterburner_right'].forEach((nodeName, burnerIndex) => {
      const burner = modelNodesRef.current[nodeName];
      if (!burner) return;
      setCloudOpacity(
        burner,
        0.14 + burnerBoost + Math.min(0.16, speed * 0.015) + Math.sin(time * 18 + burnerIndex * 1.8) * 0.06
      );
      if (burner.userData.baseScale) {
        const scalePulse = 1 + Math.sin(time * 14 + burnerIndex * 1.4) * 0.08 + burnerBoost * 0.45;
        burner.scale.set(
          burner.userData.baseScale.x * scalePulse,
          burner.userData.baseScale.y * (1 + burnerBoost * 0.8),
          burner.userData.baseScale.z * scalePulse
        );
      }
    });
    ['jet_missile_left', 'jet_missile_right'].forEach((nodeName) => {
      const missile = modelNodesRef.current[nodeName];
      if (missile) missile.visible = !p.fired;
    });
    const centerlineTank = modelNodesRef.current.jet_centerline_tank;
    if (centerlineTank && centerlineTank.userData.baseRotation) {
      centerlineTank.rotation.copy(centerlineTank.userData.baseRotation);
      centerlineTank.rotation.x += Math.sin(time * 4.2 + (p.flightAge || 0)) * 0.02;
    }
  });

  return (
    <group ref={group} scale={[JET_MODEL_SCALE, JET_MODEL_SCALE, JET_MODEL_SCALE]}>
      {jetScene ? (
        <primitive object={jetScene} />
      ) : (
        <>
          <mesh rotation={[0, 0, -Math.PI / 2]}>
            <cylinderGeometry args={[4.6, 7.8, 126, 18]} />
            <meshStandardMaterial color="#7b8794" metalness={0.68} roughness={0.34} />
          </mesh>
          <mesh position={[28, 8.4, 0]} scale={[1.85, 0.7, 0.92]}>
            <sphereGeometry args={[6.8, 16, 12]} />
            <meshStandardMaterial color="#8eb7d0" metalness={0.9} roughness={0.08} transparent opacity={0.5} />
          </mesh>
          <mesh position={[-6, 0.4, 0]} rotation={[0, 0, -0.09]}>
            <boxGeometry args={[48, 2.4, 120]} />
            <meshStandardMaterial color="#7b8794" metalness={0.58} roughness={0.36} />
          </mesh>
          <mesh position={[-54, 0, 0]}>
            <boxGeometry args={[22, 7.5, 16]} />
            <meshStandardMaterial color="#111827" metalness={0.64} roughness={0.28} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={`jet-burner-fallback-${side}`} position={[-66, -1.1, side * 4.2]} rotation={[0, 0, -Math.PI / 2]}>
              <cylinderGeometry args={[2.6, 1.4, 12, 12]} />
              <meshBasicMaterial color="#38bdf8" />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// A-10 WARTHOG — strafing run entity
// Flies across the target, fires the GAU-8 Avenger cannon (BRRRT!)
// ─────────────────────────────────────────────────────────────────────────────
const EntityWarthog = ({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const modelNodesRef = useRef({});
  const [assetReady, setAssetReady] = useState(Boolean(airstrikeAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(airstrikeAssetCache.error));

  const warthogScene = useMemo(() => {
    if (!assetReady || !airstrikeAssetCache.scene) return null;
    const clone = cloneNamedGlbGroup(airstrikeAssetCache.scene, 'a10_warthog');
    if (!clone) return null;
    clone.traverse((node) => {
      if (node.position && !node.userData.basePosition) node.userData.basePosition = node.position.clone();
      if (node.rotation && !node.userData.baseRotation) node.userData.baseRotation = node.rotation.clone();
      if (node.scale && !node.userData.baseScale) node.userData.baseScale = node.scale.clone();
    });
    modelNodesRef.current = clone.userData?.namedNodes || {};
    return clone;
  }, [assetReady]);

  useEffect(() => {
    let cancelled = false;
    if (!assetReady && !assetFailed) {
      loadAirstrikeAsset()
        .then(() => { if (!cancelled) setAssetReady(true); })
        .catch(() => { if (!cancelled) setAssetFailed(true); });
    }
    return () => { cancelled = true; };
  }, [assetReady, assetFailed]);

  useEffect(() => () => disposeClonedMaterials(warthogScene), [warthogScene]);

  useFrame((state, delta) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) {
      if (group.current) group.current.visible = false;
      return;
    }
    if (!group.current) return;

    const time = state.clock.elapsedTime;
    const speed = Math.hypot(p.vx || 0, p.vz || 0);
    const targetYaw = -Math.atan2(p.vz || 0.001, p.vx || 0.001);
    const prevYaw = p.renderYaw ?? targetYaw;
    const yawDelta = wrapAngle(targetYaw - prevYaw);
    const prevY = p.renderPrevY ?? (p.y || 0);
    const vertSpeed = ((p.y || 0) - prevY) / Math.max(delta, 0.001);

    p.renderPrevY = p.y || 0;
    p.renderYaw = prevYaw + yawDelta * Math.min(1, delta * 5.0);
    p.renderRoll = THREE.MathUtils.lerp(
      p.renderRoll ?? 0,
      THREE.MathUtils.clamp(yawDelta * 3.0, -0.55, 0.55),
      Math.min(1, delta * 5.5)
    );
    p.renderPitch = THREE.MathUtils.lerp(
      p.renderPitch ?? 0,
      THREE.MathUtils.clamp(-vertSpeed * 0.005, -0.14, 0.14) + Math.cos(time * 1.6 + (p.flightAge || 0)) * 0.015,
      Math.min(1, delta * 4.0)
    );

    group.current.position.set(p.x, p.y, p.z);
    group.current.rotation.y = p.renderYaw;
    group.current.rotation.x = p.renderPitch;
    group.current.rotation.z = p.renderRoll;
    group.current.visible = true;

    // Exhaust glow pulsing on TF34 engines
    ['warthog_exhaust_glow_left', 'warthog_exhaust_glow_right'].forEach((nodeName, i) => {
      const glow = modelNodesRef.current[nodeName];
      if (!glow) return;
      setCloudOpacity(
        glow,
        0.22 + Math.sin(time * 16 + i * 2.1) * 0.06 + (speed > 8 ? 0.10 : 0)
      );
      if (glow.userData.baseScale) {
        const pulse = 1 + Math.sin(time * 12 + i * 1.6) * 0.07;
        glow.scale.set(
          glow.userData.baseScale.x * pulse,
          glow.userData.baseScale.y * (1 + (speed > 8 ? 0.15 : 0)),
          glow.userData.baseScale.z * pulse
        );
      }
    });

    // Muzzle flash — smooth lerped pulse while firing, fully hidden when idle
    const muzzle = modelNodesRef.current.warthog_muzzle_glow;
    if (muzzle) {
      const firing = p.fireStarted && !p.fireDone;
      // Target brightness: slow 9 Hz oscillation while firing, 0 when idle
      const targetFlash = firing ? (0.60 + Math.sin(time * 9.5) * 0.40) : 0;
      // Lerp smoothly so there is no per-frame pop-in / pop-out
      p._muzzleFlash = THREE.MathUtils.lerp(p._muzzleFlash ?? 0, targetFlash, Math.min(1, delta * 20));
      if (p._muzzleFlash < 0.02) {
        // Fully invisible — skip render entirely
        muzzle.visible = false;
      } else {
        muzzle.visible = true;
        setCloudOpacity(muzzle, Math.min(1, p._muzzleFlash));
        if (muzzle.userData.baseScale) {
          const flScale = 0.4 + p._muzzleFlash * (1.2 + Math.sin(time * 11) * 0.22);
          muzzle.scale.set(
            muzzle.userData.baseScale.x * flScale,
            muzzle.userData.baseScale.y * flScale,
            muzzle.userData.baseScale.z * flScale
          );
        }
      }
    }
  });

  return (
    <group ref={group} scale={[WARTHOG_MODEL_SCALE, WARTHOG_MODEL_SCALE, WARTHOG_MODEL_SCALE]}>
      {warthogScene ? (
        <primitive object={warthogScene} />
      ) : (
        // Fallback geometry if GLB hasn't loaded
        <>
          <mesh rotation={[0, 0, -Math.PI / 2]}>
            <boxGeometry args={[118, 20, 26]} />
            <meshStandardMaterial color="#5c6355" metalness={0.38} roughness={0.52} />
          </mesh>
          <mesh position={[4, -1, 0]} rotation={[0, 0, -0.02]}>
            <boxGeometry args={[52, 4.5, 110]} />
            <meshStandardMaterial color="#3e4739" metalness={0.30} roughness={0.60} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={`warthog-exhaust-fallback-${side}`} position={[-58, 16, side * 20]} rotation={[0, 0, -Math.PI / 2]}>
              <cylinderGeometry args={[5.5, 2.8, 14, 12]} />
              <meshBasicMaterial color="#38bdf8" />
            </mesh>
          ))}
        </>
      )}
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
      prop.rotation.x = time * (52 + i * 4) + p.flightPhase * 0.6 + i * 0.35;
    });
  });
  return (
    <group ref={group} scale={[PLANE_MODEL_SCALE, PLANE_MODEL_SCALE, PLANE_MODEL_SCALE]}>
      {planeScene ? (
        <primitive object={planeScene} />
      ) : (
        // ── B-52 Strategic Bomber — polygon + shader fallback ──
        // Fuselage axis: X (nose+, tail-). Wings spread on Z. Y = up.
        <group>
          {/* ── Fuselage — tapered 10-sided tube ── */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[10, 12.5, 280, 10, 1]} />
            <meshStandardMaterial color="#7a8491" metalness={0.72} roughness={0.28} />
          </mesh>
          {/* Nose cone */}
          <mesh position={[141, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <coneGeometry args={[10, 44, 10]} />
            <meshStandardMaterial color="#9aa3ae" metalness={0.78} roughness={0.22} />
          </mesh>
          {/* Glazed nose bubble */}
          <mesh position={[148, 2, 0]} scale={[1.8, 0.9, 1.0]}>
            <sphereGeometry args={[7.5, 12, 10]} />
            <meshStandardMaterial color="#c8dde8" transparent opacity={0.45} metalness={0.9} roughness={0.04} />
          </mesh>
          {/* Tail section — narrow taper */}
          <mesh position={[-134, 4, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[7, 11, 40, 10, 1]} />
            <meshStandardMaterial color="#6e7880" metalness={0.68} roughness={0.34} />
          </mesh>

          {/* ── Main swept wings — wide thin box, angled back ── */}
          {/* Port wing */}
          <mesh position={[-22, -3, -95]} rotation={[0, -0.22, -0.035]}>
            <boxGeometry args={[60, 3.2, 192]} />
            <meshStandardMaterial color="#7a8491" metalness={0.62} roughness={0.36} />
          </mesh>
          {/* Starboard wing */}
          <mesh position={[-22, -3, 95]} rotation={[0, 0.22, -0.035]}>
            <boxGeometry args={[60, 3.2, 192]} />
            <meshStandardMaterial color="#7a8491" metalness={0.62} roughness={0.36} />
          </mesh>
          {/* Wing leading edge highlight */}
          {[-1, 1].map(side => (
            <mesh key={`wing-le-${side}`} position={[10, -2.8, side * 95]} rotation={[0, side * -0.22, 0]}>
              <boxGeometry args={[8, 2.2, 192]} />
              <meshStandardMaterial color="#9aa3ae" metalness={0.82} roughness={0.18} />
            </mesh>
          ))}

          {/* ── Horizontal stabilizer (tail) ── */}
          {[-1, 1].map(side => (
            <mesh key={`stab-${side}`} position={[-128, 8, side * 54]} rotation={[0, side * -0.12, 0.04]}>
              <boxGeometry args={[36, 2.2, 110]} />
              <meshStandardMaterial color="#6e7880" metalness={0.64} roughness={0.38} />
            </mesh>
          ))}
          {/* Vertical tail fin */}
          <mesh position={[-108, 26, 0]} rotation={[0, 0, 0.08]}>
            <boxGeometry args={[50, 52, 3.2]} />
            <meshStandardMaterial color="#6e7880" metalness={0.66} roughness={0.36} />
          </mesh>
          {/* Tail fin tip */}
          <mesh position={[-88, 52, 0]}>
            <boxGeometry args={[22, 3, 3]} />
            <meshStandardMaterial color="#9aa3ae" metalness={0.76} roughness={0.24} />
          </mesh>

          {/* ── 8 Engines in 4 paired nacelles under wings ── */}
          {/* Engine pod positions: 4 per side, Z = ±30/±68/±105/±142 from centerline */}
          {[
            { z: -30,  x: -10 }, { z: -68,  x: -28 },
            { z: -105, x: -46 }, { z: -142, x: -64 },
            { z:  30,  x: -10 }, { z:  68,  x: -28 },
            { z:  105, x: -46 }, { z:  142, x: -64 },
          ].map(({ z, x }, i) => (
            <group key={`eng-${i}`} position={[x, -20, z]}>
              {/* Nacelle body */}
              <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[5.5, 6.2, 38, 9, 1]} />
                <meshStandardMaterial color="#4a5260" metalness={0.76} roughness={0.28} />
              </mesh>
              {/* Engine inlet ring */}
              <mesh position={[20, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <torusGeometry args={[5.8, 0.9, 8, 16]} />
                <meshStandardMaterial color="#2e3540" metalness={0.88} roughness={0.14} />
              </mesh>
              {/* Pylon strut to wing */}
              <mesh position={[0, 10, 0]}>
                <boxGeometry args={[6, 20, 4]} />
                <meshStandardMaterial color="#5a6270" metalness={0.68} roughness={0.34} />
              </mesh>
              {/* Exhaust glow */}
              <mesh position={[-22, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[4.2, 5.2, 6, 9]} />
                <meshBasicMaterial color="#fbbf24" transparent opacity={0.55 + Math.sin(i * 1.3) * 0.12} />
              </mesh>
            </group>
          ))}

          {/* ── Bomb bay doors (slightly open) ── */}
          {[-1, 1].map(side => (
            <mesh key={`bay-${side}`} position={[-10, -13, side * 5.5]} rotation={[side * 0.18, 0, 0]}>
              <boxGeometry args={[48, 1.2, 11]} />
              <meshStandardMaterial color="#3a4250" metalness={0.55} roughness={0.48} />
            </mesh>
          ))}

          {/* ── Contrail sources — ghostly white streaks from each engine tip ── */}
          {[
            -30, -68, -105, -142,
             30,  68,  105,  142,
          ].map((z, i) => {
            const x = -10 - Math.abs(z) * 0.38;
            return (
              <mesh key={`contrail-${i}`} position={[x - 36, -20, z]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[1.4, 3.8, 120 + i * 8, 6]} />
                <meshBasicMaterial color="#e0edf5" transparent opacity={0.12 + i * 0.01} />
              </mesh>
            );
          })}

          {/* ── Wing-tip nav lights ── */}
          <mesh position={[-56, -4, -188]}>
            <sphereGeometry args={[2.8, 7, 6]} />
            <meshBasicMaterial color="#ef4444" transparent opacity={0.9} />
          </mesh>
          <mesh position={[-56, -4,  188]}>
            <sphereGeometry args={[2.8, 7, 6]} />
            <meshBasicMaterial color="#86efac" transparent opacity={0.9} />
          </mesh>
        </group>
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

const NUKE_CLOUD_GLB_PATH = '/fallout/nuke_cloud.glb?v=20260406a';
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

// ─── Robust GLTFLoader helper ────────────────────────────────────────────────
// Creates a GLTFLoader that forces TextureLoader (uses <img> elements) instead
// of ImageBitmapLoader (uses fetch() which service workers can intercept on
// blob: URLs).  This eliminates "Couldn't load texture blob:..." errors.
const createRobustGLTFLoader = () => {
  const loader = new GLTFLoader();
  const origParse = loader.parse.bind(loader);
  loader.parse = function (data, path, onLoad, onError) {
    // GLTFParser constructor (called synchronously inside parse) checks
    // createImageBitmap to choose between ImageBitmapLoader and TextureLoader.
    // Hide createImageBitmap for the duration of the synchronous constructor,
    // then restore it immediately.  The parser snapshots its textureLoader
    // choice so all later async texture loads use TextureLoader (which loads
    // via <img> elements and never goes through service worker fetch events).
    const saved = typeof self !== 'undefined' ? self.createImageBitmap : undefined;
    if (typeof self !== 'undefined') self.createImageBitmap = undefined;
    origParse(data, path, onLoad, onError);
    if (typeof self !== 'undefined') self.createImageBitmap = saved;
  };
  return loader;
};

const loadNukeCloudAsset = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (nukeCloudAssetCache.scene) return Promise.resolve(nukeCloudAssetCache.scene);
  if (nukeCloudAssetCache.promise) return nukeCloudAssetCache.promise;

  const loader = createRobustGLTFLoader();
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

const WORLD_PROPS_GLB_PATH = '/fallout/world_props.glb?v=20260404b';
const worldPropsAssetCache = {
  scene: null,
  promise: null,
  error: null
};

const globalShaderUniforms = { time: { value: 0 } };

const enhanceMaterialWithAliveShader = (material) => {
  if (!material) return material;
  const clone = material.clone();
  // Keep all original material settings — only add shader effects on top
  clone.depthWrite = true;
  clone.depthTest = true;

  // ── CRITICAL: The customProgramCacheKey MUST encode which texture slots
  // are active.  Three.js reuses compiled shader programs by this key.
  // If a map-less material compiles first with the same key, the compiled
  // program won't sample textures — and every later material sharing that
  // key will also be textureless, even if it has a .map assigned.
  clone.customProgramCacheKey = () => {
    let key = 'alive-v3';
    if (clone.map) key += '_map';
    if (clone.normalMap) key += '_nrm';
    if (clone.roughnessMap) key += '_rgh';
    if (clone.metalnessMap) key += '_met';
    if (clone.emissiveMap) key += '_ems';
    if (clone.aoMap) key += '_ao';
    if (clone.bumpMap) key += '_bmp';
    if (clone.alphaMap) key += '_alp';
    if (clone.transparent) key += '_t';
    return key;
  };

  clone.onBeforeCompile = (shader) => {
    shader.uniforms.globalTime = globalShaderUniforms.time;

    // ── Vertex: expose world-space position and normal ───────────────────
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vWPos;
       varying vec3 vWNorm;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vWPos  = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vWNorm = normalize(mat3(modelMatrix) * normal);`
    );

    // ── Fragment: subtle realism pass that preserves the original PBR look ──
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform float globalTime;
       varying vec3 vWPos;
       varying vec3 vWNorm;`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>

       // ── Preserve the original Three.js PBR output (textures, roughness, etc.)
       vec3 base = gl_FragColor.rgb;
       vec3 viewDir = normalize(cameraPosition - vWPos);
       vec3 upDir = vec3(0.0, 1.0, 0.0);
       vec3 sunDir = normalize(vec3(0.42, 0.9, 0.28));

       float cosTheta = max(dot(vWNorm, viewDir), 0.0);
       float fresnel = pow(1.0 - cosTheta, 5.0);
       float upLight = clamp(dot(vWNorm, upDir) * 0.5 + 0.5, 0.0, 1.0);
       float sunFacing = max(dot(vWNorm, sunDir), 0.0);
       float backScatter = pow(max(dot(-viewDir, sunDir), 0.0), 2.0) * fresnel;

       vec3 halfDir = normalize(sunDir + viewDir);
       float spec = pow(max(dot(vWNorm, halfDir), 0.0), 64.0);

       // Gentle ambient shaping so large forms read better without looking painted
       vec3 skyFill = vec3(0.16, 0.22, 0.30) * pow(upLight, 1.35) * 0.14;
       vec3 groundBounce = vec3(0.10, 0.07, 0.04) * pow(1.0 - upLight, 1.7) * 0.08;
       vec3 sunTint = vec3(1.0, 0.96, 0.9) * sunFacing * 0.07;
       vec3 rimTint = vec3(0.58, 0.68, 0.78) * fresnel * (0.045 + backScatter * 0.08);
       vec3 specAdd = vec3(1.0, 0.98, 0.93) * spec * (0.16 + sunFacing * 0.12);

       // Subtle world-space breakup to stop giant meshes from reading too smooth
       float grainA = sin(vWPos.x * 0.12 + vWPos.z * 0.18 + globalTime * 0.05);
       float grainB = sin(vWPos.y * 0.2 - vWPos.x * 0.11);
       float grain = grainA * grainB * 0.5 + 0.5;
       float luminance = dot(base, vec3(0.2126, 0.7152, 0.0722));
       vec3 poreVariation = base * ((grain - 0.5) * (0.035 + (1.0 - luminance) * 0.045));

       vec3 finalColor = base + skyFill + groundBounce + sunTint + rimTint + specAdd + poreVariation;

       // Soft HDR clamp — keep highlights punchy without looking neon
       finalColor = min(finalColor, vec3(1.55));

       gl_FragColor = vec4(finalColor, gl_FragColor.a);
      `
    );
  };
  clone.needsUpdate = true;
  return clone;
};

const cloneGlbMaterialForRender = (material, options = {}) => {
  if (!material) return material;
  const { applyAliveShaderToTextured = false } = options;

  const hasTextureMap = Boolean(
    material.map ||
    material.normalMap ||
    material.roughnessMap ||
    material.metalnessMap ||
    material.emissiveMap ||
    material.aoMap ||
    material.bumpMap ||
    material.alphaMap
  );

  if (!hasTextureMap) {
    return enhanceMaterialWithAliveShader(material);
  }

  const clone = material.clone();
  clone.depthWrite = true;
  clone.depthTest = true;

  if (clone.map) {
    clone.map.colorSpace = THREE.SRGBColorSpace;
    clone.map.anisotropy = 8;
    clone.map.generateMipmaps = true;
    clone.map.minFilter = THREE.LinearMipmapLinearFilter;
    clone.map.magFilter = THREE.LinearFilter;
    clone.map.needsUpdate = true;
  }
  if (clone.emissiveMap) {
    clone.emissiveMap.colorSpace = THREE.SRGBColorSpace;
    clone.emissiveMap.anisotropy = 8;
    clone.emissiveMap.needsUpdate = true;
  }
  if (clone.normalMap) clone.normalMap.needsUpdate = true;
  if (clone.roughnessMap) clone.roughnessMap.needsUpdate = true;
  if (clone.metalnessMap) clone.metalnessMap.needsUpdate = true;
  if (clone.aoMap) clone.aoMap.needsUpdate = true;
  if (clone.bumpMap) clone.bumpMap.needsUpdate = true;
  if (clone.alphaMap) clone.alphaMap.needsUpdate = true;

  if (applyAliveShaderToTextured) {
    return enhanceMaterialWithAliveShader(clone);
  }

  clone.needsUpdate = true;
  return clone;
};

const makeGeometryAlive = (object) => {
  // Intentionally left empty — do NOT recompute vertex normals.
  // The .glb files contain carefully baked split/hard-edge normals that
  // define all the panel lines, seams and surface detail. Calling
  // computeVertexNormals() would average them away into a featureless blob.
};

// React component wrapper for standard materials to inject the alive shader
const AliveMaterial = memo(({ color, roughness = 0.8, metalness = 0.2, emissive, emissiveIntensity, side = THREE.FrontSide, transparent = false, opacity = 1 }) => {
  const material = useMemo(() => {
    const materialConfig = {
      color,
      roughness,
      metalness,
      side,
      transparent,
      opacity
    };

    if (emissive !== undefined) materialConfig.emissive = emissive;
    if (emissiveIntensity !== undefined) materialConfig.emissiveIntensity = emissiveIntensity;

    const mat = new THREE.MeshStandardMaterial(materialConfig);
    return enhanceMaterialWithAliveShader(mat);
  }, [color, roughness, metalness, emissive, emissiveIntensity, side, transparent, opacity]);

  useEffect(() => {
    return () => material?.dispose?.();
  }, [material]);

  return <primitive object={material} attach="material" />;
});

const cloneNamedGlbGroup = (scene, name, materialOptions = {}) => {
  const source = scene?.getObjectByName?.(name);
  if (!source) return null;
  const clone = source.clone(true);
  const namedNodes = {};
  clone.traverse((object) => {
    if (object.name) {
      namedNodes[object.name] = object;
    }
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
    makeGeometryAlive(object);
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => cloneGlbMaterialForRender(material, materialOptions));
    } else {
      object.material = cloneGlbMaterialForRender(object.material, materialOptions);
    }
  });
  clone.userData.namedNodes = namedNodes;
  return clone;
};

const findCloneNodeByPrefix = (object, prefix) => {
  if (!object || !prefix) return null;
  const namedNodes = object.userData?.namedNodes || {};
  if (namedNodes[prefix]) return namedNodes[prefix];
  const entry = Object.entries(namedNodes).find(([name]) => name === prefix || name.startsWith(`${prefix}_`));
  return entry?.[1] || null;
};

const snapshotNodeTransform = (node) => {
  if (!node) return null;
  return {
    position: node.position.clone(),
    rotation: node.rotation.clone(),
    scale: node.scale.clone()
  };
};

const buildSoldierAnimationRig = (object) => {
  if (!object) return null;

  const makePart = (prefix) => {
    const node = findCloneNodeByPrefix(object, prefix);
    if (!node) return null;
    return {
      node,
      base: snapshotNodeTransform(node)
    };
  };

  return {
    torso: makePart('unit_torso'),
    vest: makePart('unit_vest'),
    pack: makePart('unit_pack'),
    belt: makePart('unit_belt'),
    head: makePart('unit_head'),
    helmet: makePart('unit_helmet'),
    visor: makePart('unit_visor'),
    neckWrap: makePart('unit_neck_wrap'),
    legLeft: makePart('unit_leg_left'),
    legRight: makePart('unit_leg_right'),
    bootLeft: makePart('unit_boot_left'),
    bootRight: makePart('unit_boot_right'),
    armLeft: makePart('unit_arm_left'),
    armRight: makePart('unit_arm_right'),
    padLeft: makePart('unit_pad_left'),
    padRight: makePart('unit_pad_right'),
    weapon: makePart('unit_weapon'),
    tool: makePart('unit_tool'),
    toolCanister: makePart('unit_tool_canister'),
    torch: makePart('unit_torch')
  };
};

const applyRigTransform = (part, delta, targets = {}, damping = 10) => {
  if (!part?.node || !part.base) return;

  const t = Math.min(1, delta * damping);
  const { node, base } = part;
  const position = targets.position || {};
  const rotation = targets.rotation || {};
  const scale = targets.scale || {};

  node.position.x = THREE.MathUtils.lerp(node.position.x, base.position.x + (position.x || 0), t);
  node.position.y = THREE.MathUtils.lerp(node.position.y, base.position.y + (position.y || 0), t);
  node.position.z = THREE.MathUtils.lerp(node.position.z, base.position.z + (position.z || 0), t);

  node.rotation.x = THREE.MathUtils.lerp(node.rotation.x, base.rotation.x + (rotation.x || 0), t);
  node.rotation.y = THREE.MathUtils.lerp(node.rotation.y, base.rotation.y + (rotation.y || 0), t);
  node.rotation.z = THREE.MathUtils.lerp(node.rotation.z, base.rotation.z + (rotation.z || 0), t);

  node.scale.x = THREE.MathUtils.lerp(node.scale.x, base.scale.x * (scale.x || 1), t);
  node.scale.y = THREE.MathUtils.lerp(node.scale.y, base.scale.y * (scale.y || 1), t);
  node.scale.z = THREE.MathUtils.lerp(node.scale.z, base.scale.z * (scale.z || 1), t);
};

const cloneGlbSceneRoot = (scene) => {
  if (!scene) return null;
  const clone = scene.clone(true);
  const namedNodes = {};
  let meshCount = 0;
  clone.traverse((object) => {
    object.visible = true;
    if (object.name) {
      namedNodes[object.name] = object;
    }
    if (!object.isMesh) return;
    meshCount += 1;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
    makeGeometryAlive(object);
    if (Array.isArray(object.material)) {
      object.material = object.material.map(cloneGlbMaterialForRender);
    } else {
      object.material = cloneGlbMaterialForRender(object.material);
    }
  });
  clone.userData.namedNodes = namedNodes;
  clone.userData.meshCount = meshCount;
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

  const loader = createRobustGLTFLoader();
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

const AIRSTRIKE_ASSETS_GLB_PATH = '/fallout/airstrike_assets.glb?v=20260403c';
const airstrikeAssetCache = {
  scene: null,
  promise: null,
  error: null
};

const BASE_STRUCTURES_GLB_PATH = '/fallout/base_structures.glb?v=20260406a';
const baseStructuresAssetCache = {
  scene: null,
  promise: null,
  error: null
};
const COMMAND_EFFECTS_GLB_PATH = '/fallout/command_effects.glb?v=20260406a';
const commandEffectsAssetCache = {
  scene: null,
  promise: null,
  error: null
};
const KAIJU_ASSETS_GLB_PATH = '/fallout/kaiju_assets.glb?v=20260404a';
const kaijuAssetsAssetCache = {
  scene: null,
  promise: null,
  error: null
};
const HUMAN_UNITS_GLB_PATH = '/fallout/human_units.glb?v=20260406a';
const humanUnitsAssetCache = {
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
const COMMAND_EFFECT_ASSET_NAMES = {
  orbital_lance: 'support_orbital_lance',
  firestorm: 'support_firestorm',
  kinetic_spear: 'support_kinetic_spear'
};
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

  const loader = createRobustGLTFLoader();
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

  const loader = createRobustGLTFLoader();
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

const loadCommandEffectsAsset = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (commandEffectsAssetCache.scene) return Promise.resolve(commandEffectsAssetCache.scene);
  if (commandEffectsAssetCache.promise) return commandEffectsAssetCache.promise;
  if (commandEffectsAssetCache.error) return Promise.resolve(null);

  const loader = createRobustGLTFLoader();
  commandEffectsAssetCache.promise = loader.loadAsync(COMMAND_EFFECTS_GLB_PATH)
    .then((gltf) => {
      commandEffectsAssetCache.scene = gltf.scene;
      commandEffectsAssetCache.error = null;
      commandEffectsAssetCache.promise = null;
      return gltf.scene;
    })
    .catch((error) => {
      commandEffectsAssetCache.error = error;
      commandEffectsAssetCache.promise = null;
      console.warn('Command effects GLB unavailable, using fallback support visuals.', error);
      return null;
    });

  return commandEffectsAssetCache.promise;
};

const loadKaijuAssetsAsset = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (kaijuAssetsAssetCache.scene) return Promise.resolve(kaijuAssetsAssetCache.scene);
  if (kaijuAssetsAssetCache.promise) return kaijuAssetsAssetCache.promise;

  const loader = createRobustGLTFLoader();
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

const loadHumanUnitsAsset = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (humanUnitsAssetCache.scene) return Promise.resolve(humanUnitsAssetCache.scene);
  if (humanUnitsAssetCache.promise) return humanUnitsAssetCache.promise;

  const loader = createRobustGLTFLoader();
  humanUnitsAssetCache.promise = loader.loadAsync(HUMAN_UNITS_GLB_PATH)
    .then((gltf) => {
      humanUnitsAssetCache.scene = gltf.scene;
      humanUnitsAssetCache.error = null;
      humanUnitsAssetCache.promise = null;
      return gltf.scene;
    })
    .catch((error) => {
      humanUnitsAssetCache.error = error;
      humanUnitsAssetCache.promise = null;
      console.warn('Failed to load human units GLB, using fallback soldier render.', error);
      return null;
    });

  return humanUnitsAssetCache.promise;
};

const EntityMushroomCloud = memo(({ entityId, index, entitiesRef, entityLookupRef }) => {
  const groupRef = useRef();
  const fallbackStemRef = useRef();
  const fallbackCapRef = useRef();
  const fallbackRingRef = useRef();
  const fallbackFlashRef = useRef();
  const fallbackEmberRef = useRef();
  const lightRef = useRef();
  const light2Ref = useRef();
  const cloudNodesRef = useRef({});
  const [assetReady, setAssetReady] = useState(Boolean(nukeCloudAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(nukeCloudAssetCache.error));

  const cloudScene = useMemo(() => {
    if (!assetReady || !nukeCloudAssetCache.scene) return null;
    const clone = cloneNukeCloudScene(nukeCloudAssetCache.scene);
    cloudNodesRef.current = clone.userData.namedNodes || {};
    return clone;
  }, [assetReady]);
  const useFallback = !cloudScene;

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
    const fireCoreGlow = Math.max(0, 1 - age / 60);
    const time = state.clock.elapsedTime;
    const rootScale = (0.45 + Math.pow(progress, 0.85) * 4.6) * blastScale;

    if (groupRef.current) {
      groupRef.current.visible = true;
      groupRef.current.position.set(p.x, p.y || 0, p.z);
      groupRef.current.scale.setScalar(rootScale);
      // Gentle swaying — asymmetric so it feels organic
      groupRef.current.rotation.y = Math.sin(time * 0.6 + blastScale * 0.7) * 0.04
        + Math.sin(time * 1.1) * 0.015;
    }

    const nodes = cloudNodesRef.current;

    if (!useFallback) {
      // ── Multi-segment stem: each segment rises with staggered timing ──
      for (let i = 0; i < 4; i++) {
        const seg = nodes[`nuke_stem_${i}`];
        if (!seg) continue;
        const segProgress = Math.min(1, Math.max(0, (progress - i * 0.06) / 0.7));
        applyBaseScale(seg, 0.5 + segProgress * 1.5, segProgress * (10 + i * 6));
        // Each segment rotates slightly differently — turbulent pillar
        seg.rotation.y = Math.sin(time * (0.8 + i * 0.3) + i * 1.2) * (0.04 + i * 0.02);
        seg.rotation.x = Math.sin(time * (0.5 + i * 0.2) + i * 2.1) * 0.015;
        setCloudOpacity(seg, fadeAlpha * (0.65 + i * 0.04));
        // Pulse emissive intensity on stem segments
        if (seg.material && seg.material.emissiveIntensity !== undefined) {
          seg.material.emissiveIntensity = (0.08 + fireCoreGlow * 0.3) * (1 + Math.sin(time * 3 + i) * 0.3);
        }
      }

      // ── Updraft smoke columns: spiral upward ──
      for (let i = 0; i < 6; i++) {
        const updraft = nodes[`nuke_updraft_${i}`];
        if (!updraft) continue;
        const uProgress = Math.min(1, Math.max(0, (progress - 0.08) / 0.65));
        applyBaseScale(updraft, 0.3 + uProgress * 1.2, uProgress * (15 + i * 4));
        // Spiral rotation around stem
        updraft.rotation.y = time * (0.4 + i * 0.15) + i * (Math.PI / 3);
        updraft.rotation.z = Math.sin(time * 1.2 + i * 0.9) * 0.06;
        setCloudOpacity(updraft, fadeAlpha * uProgress * 0.3);
      }

      // ── Plume ──
      const plume = nodes.nuke_plume;
      if (plume) {
        applyBaseScale(plume, 0.72 + progress * 1.28, progress * 18);
        plume.rotation.y = time * 0.22 + Math.sin(time * 0.7) * 0.1;
        plume.rotation.x = Math.sin(time * 0.4) * 0.03;
        setCloudOpacity(plume, fadeAlpha * 0.68);
      }

      // ── Cap — gentle wobble ──
      const capNode = nodes.nuke_cap;
      if (capNode) {
        applyBaseScale(capNode, 0.76 + progress * 1.18, progress * 26);
        capNode.rotation.y = -time * 0.14 + Math.sin(time * 0.9) * 0.06;
        capNode.rotation.x = Math.sin(time * 0.35 + 1.5) * 0.025;
        capNode.rotation.z = Math.sin(time * 0.42) * 0.02;
        setCloudOpacity(capNode, fadeAlpha * 0.84);
        // Pulsing emissive on cap
        if (capNode.material && capNode.material.emissiveIntensity !== undefined) {
          capNode.material.emissiveIntensity = 0.15 + fireCoreGlow * 0.2 + Math.sin(time * 2.5) * 0.06;
        }
      }

      // ── Lobes — per-lobe turbulent billowing ──
      Object.keys(nodes).forEach((name, idx) => {
        if (!name.startsWith('nuke_lobe_')) return;
        const lobe = nodes[name];
        const lobeIdx = parseInt(name.replace('nuke_lobe_', ''), 10);
        // Staggered growth + noise-like wobble
        const lobePhase = lobeIdx * 0.73;
        const lobeProg = Math.min(1, Math.max(0, (progress - lobeIdx * 0.025) / 0.8));
        const billow = Math.sin(time * (1.4 + lobeIdx * 0.3) + lobePhase) * 0.08;
        const billow2 = Math.sin(time * (0.9 + lobeIdx * 0.2) + lobePhase * 2.1) * 0.05;
        applyBaseScale(lobe, 0.7 + lobeProg * 0.9 + billow, lobeProg * (18 + lobeIdx * 2.5));
        // Each lobe independently rotates for rolling cloud look
        lobe.rotation.y = Math.sin(time * (0.6 + lobeIdx * 0.18) + lobePhase) * 0.12;
        lobe.rotation.x = Math.cos(time * (0.4 + lobeIdx * 0.14) + lobePhase * 1.3) * 0.08;
        lobe.rotation.z = Math.sin(time * (0.5 + lobeIdx * 0.11) + lobePhase * 0.7) * 0.06 + billow2;
        setCloudOpacity(lobe, fadeAlpha * (0.55 + lobeIdx * 0.04 + billow * 0.3));
      });

      // ── Rolling smoke ring — rotates and pulses ──
      const smokeRing = nodes.nuke_smoke_ring;
      if (smokeRing) {
        const srProg = Math.min(1, Math.max(0, (progress - 0.15) / 0.6));
        applyBaseScale(smokeRing, 0.5 + srProg * 1.6, srProg * 8);
        smokeRing.rotation.x = Math.PI / 2;
        smokeRing.rotation.z = time * 0.35;
        // Pulsing scale on the tube cross-section
        const pulse = 1 + Math.sin(time * 2.8) * 0.12;
        if (smokeRing.userData.baseScale) {
          smokeRing.scale.y = smokeRing.userData.baseScale.y * (0.5 + srProg * 1.6) * pulse;
        }
        setCloudOpacity(smokeRing, fadeAlpha * srProg * 0.38);
      }

      // ── Fire core — pulsing glow ──
      const fireCore = nodes.nuke_fire_core;
      if (fireCore) {
        const corePulse = 1 + Math.sin(time * 5.5) * 0.25 + Math.sin(time * 8.2) * 0.12;
        applyBaseScale(fireCore, (0.6 + fireCoreGlow * 2.4) * corePulse, 0);
        setCloudOpacity(fireCore, fadeAlpha * fireCoreGlow * 0.7);
        if (fireCore.material) {
          fireCore.material.emissiveIntensity = fireCoreGlow * 2.5 * corePulse;
        }
      }

      // ── Cap underside glow ──
      const capGlow = nodes.nuke_cap_glow;
      if (capGlow) {
        const glowProg = Math.min(1, Math.max(0, (progress - 0.1) / 0.5));
        applyBaseScale(capGlow, 0.4 + glowProg * 1.8, progress * 20);
        capGlow.rotation.x = Math.PI / 2;
        const glowPulse = 1 + Math.sin(time * 3.2 + 0.5) * 0.15;
        setCloudOpacity(capGlow, fadeAlpha * fireCoreGlow * 0.5 * glowPulse);
        if (capGlow.material) {
          capGlow.material.emissiveIntensity = fireCoreGlow * 2.0 * glowPulse;
        }
      }

      // ── Ember ──
      const emberNode = nodes.nuke_ember;
      if (emberNode) {
        const emberPulse = 1 + Math.sin(time * 4.2) * 0.18;
        applyBaseScale(emberNode, (0.85 + emberGlow * 2.6) * emberPulse, 0);
        setCloudOpacity(emberNode, fadeAlpha * (0.28 + emberGlow * 0.56));
        if (emberNode.material) {
          emberNode.material.emissiveIntensity = emberGlow * 1.8 * emberPulse;
        }
      }

      // ── 3 Shock rings — staggered expansion ──
      for (let i = 0; i < 3; i++) {
        const ring = nodes[`nuke_ring_${i}`];
        if (!ring) continue;
        const ringDelay = i * 0.08;
        const rProg = Math.min(1, Math.max(0, (ringProgress - ringDelay) / (1 - ringDelay)));
        const rScale = 0.48 + Math.pow(rProg, 0.55) * (10 + i * 3);
        applyBaseScale(ring, rScale, 0);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = (ring.userData.basePosition?.y || 6) + Math.pow(rProg, 0.5) * (5 + i * 2);
        setCloudOpacity(ring, fadeAlpha * Math.max(0, 1 - rProg) * (0.45 - i * 0.08));
      }

      // ── Flash ──
      const flashNode = nodes.nuke_flash;
      if (flashNode) {
        applyBaseScale(flashNode, 0.8 + blastFlash * 5.5, blastFlash * 10);
        setCloudOpacity(flashNode, fadeAlpha * blastFlash * 0.75);
        if (flashNode.material) {
          flashNode.material.emissiveIntensity = blastFlash * 3.0;
        }
      }

      // ── Ground dust skirt — expanding outward ──
      const dustSkirt = nodes.nuke_dust_skirt;
      if (dustSkirt) {
        const dustProg = Math.min(1, Math.max(0, (progress - 0.02) / 0.5));
        const dustExpand = 0.3 + Math.pow(dustProg, 0.6) * 4.5;
        applyBaseScale(dustSkirt, dustExpand, 0);
        dustSkirt.rotation.y = time * 0.08;
        setCloudOpacity(dustSkirt, fadeAlpha * dustProg * 0.28 * Math.max(0, 1 - (progress - 0.3) / 0.7));
      }

      // ── Debris chunks — fly outward and tumble ──
      for (let i = 0; i < 8; i++) {
        const debris = nodes[`nuke_debris_${i}`];
        if (!debris) continue;
        const dProg = Math.min(1, Math.max(0, (progress - 0.01) / 0.4));
        const angle = (i / 8) * Math.PI * 2 + i * 0.37;
        const dist = (20 + (i % 3) * 10) * (1 + dProg * 3);
        const height = (4 + (i % 4) * 8) * (1 + dProg * 1.5) * Math.max(0, 1 - dProg * 0.8);
        debris.position.set(
          Math.cos(angle + dProg * 0.3) * dist,
          height,
          Math.sin(angle + dProg * 0.3) * dist
        );
        // Tumbling rotation
        debris.rotation.x = time * (2.5 + i * 0.8);
        debris.rotation.z = time * (1.8 + i * 0.6);
        applyBaseScale(debris, 0.8 + dProg * 0.5, 0);
        setCloudOpacity(debris, fadeAlpha * Math.max(0, 1 - dProg * 1.3) * 0.8);
      }

      // ── Heat distortion column — subtle shimmer ──
      const heatCol = nodes.nuke_heat_column;
      if (heatCol) {
        const heatProg = Math.min(1, progress / 0.6);
        applyBaseScale(heatCol, 0.5 + heatProg * 1.2, heatProg * 12);
        heatCol.rotation.y = time * 0.15;
        // Shimmering opacity
        const shimmer = 0.04 + Math.sin(time * 6) * 0.02 + Math.sin(time * 9.3) * 0.01;
        setCloudOpacity(heatCol, fadeAlpha * fireCoreGlow * shimmer);
      }
    }

    // ── Fallback rendering (no GLB) ──
    if (fallbackStemRef.current) {
      fallbackStemRef.current.visible = true;
      fallbackStemRef.current.scale.set(0.9 + progress * 1.2, 0.6 + progress * 3.2, 0.9 + progress * 1.2);
      fallbackStemRef.current.position.y = 32 + progress * 92;
      fallbackStemRef.current.material.opacity = fadeAlpha * (cloudScene ? 0.22 : 0.6);
    }

    if (fallbackCapRef.current) {
      fallbackCapRef.current.visible = true;
      fallbackCapRef.current.scale.set(1.2 + progress * 2.2, 0.7 + progress * 0.8, 1.2 + progress * 2.2);
      fallbackCapRef.current.position.y = 126 + progress * 120;
      fallbackCapRef.current.material.opacity = fadeAlpha * (cloudScene ? 0.26 : 0.72);
    }

    if (fallbackRingRef.current) {
      fallbackRingRef.current.visible = true;
      fallbackRingRef.current.scale.setScalar(0.6 + Math.pow(ringProgress, 0.58) * 12);
      fallbackRingRef.current.position.y = 2 + ringProgress * 4;
      fallbackRingRef.current.material.opacity = fadeAlpha * (1 - ringProgress) * (cloudScene ? 0.2 : 0.32);
    }

    if (fallbackFlashRef.current) {
      fallbackFlashRef.current.visible = blastFlash > 0.02;
      fallbackFlashRef.current.scale.setScalar(1 + blastFlash * 7.5);
      fallbackFlashRef.current.position.y = 48 + blastFlash * 18;
      fallbackFlashRef.current.material.opacity = fadeAlpha * blastFlash * (cloudScene ? 0.24 : 0.46);
    }

    if (fallbackEmberRef.current) {
      fallbackEmberRef.current.visible = emberGlow > 0.02;
      fallbackEmberRef.current.scale.setScalar(0.9 + emberGlow * 2.8);
      fallbackEmberRef.current.position.y = 22;
      fallbackEmberRef.current.material.opacity = fadeAlpha * emberGlow * (cloudScene ? 0.3 : 0.54);
    }

    // ── Two lights: one ground-level ember, one cap-level glow ──
    if (lightRef.current) {
      lightRef.current.position.y = (70 + progress * 180) * blastScale;
      lightRef.current.distance = 900 * blastScale;
      lightRef.current.intensity = fadeAlpha * Math.max(0, 42 * blastFlash + 12 * emberGlow);
    }
    if (light2Ref.current) {
      light2Ref.current.position.y = 16 * blastScale;
      light2Ref.current.distance = 600 * blastScale;
      light2Ref.current.intensity = fadeAlpha * fireCoreGlow * (18 + Math.sin(time * 5) * 6);
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
      <pointLight
        ref={light2Ref}
        position={[0, 16, 0]}
        color="#ff5500"
        intensity={0}
        distance={600}
        decay={2.0}
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

// ─────────────────────────────────────────────────────────────────────────────
// EntitySupportStrikeEffect — fully procedural, zero async dependencies.
// All three effects (orbital_lance, firestorm, kinetic_spear) are driven
// entirely by useFrame so they ALWAYS animate regardless of GLB load state.
// ─────────────────────────────────────────────────────────────────────────────
const EntitySupportStrikeEffect = memo(({ entityId, index, entitiesRef, entityLookupRef }) => {
  const group = useRef();
  const r = useRef({}); // keyed mesh refs
  const effectNodesRef = useRef({});
  const [assetReady, setAssetReady] = useState(Boolean(commandEffectsAssetCache.scene));
  const [assetFailed, setAssetFailed] = useState(Boolean(commandEffectsAssetCache.error));
  const trackedEffect = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
  const effectAssetName = trackedEffect ? COMMAND_EFFECT_ASSET_NAMES[trackedEffect.kind] : null;
  const effectScene = useMemo(() => {
    if (!assetReady || !commandEffectsAssetCache.scene || !effectAssetName) {
      effectNodesRef.current = {};
      return null;
    }
    const clone = cloneNamedGlbGroup(commandEffectsAssetCache.scene, effectAssetName, { castShadow: false, receiveShadow: false });
    clone?.traverse((object) => {
      if (object.name) {
        object.userData.basePosition = object.position.clone();
        object.userData.baseScale = object.scale.clone();
      }
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
      object.frustumCulled = false;
    });
    effectNodesRef.current = clone?.userData?.namedNodes || {};
    return clone;
  }, [assetReady, effectAssetName]);

  useEffect(() => {
    let cancelled = false;
    if (!assetReady && !assetFailed) {
      loadCommandEffectsAsset()
        .then((scene) => {
          if (!cancelled && scene) setAssetReady(true);
          if (!cancelled && !scene) setAssetFailed(true);
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
      if (effectScene) disposeClonedMaterials(effectScene);
    };
  }, [effectScene]);

  useFrame((state) => {
    const p = getTrackedEntity({ entitiesRef, entityLookupRef, entityId, index });
    if (!p || p.dead) { if (group.current) group.current.visible = false; return; }
    if (!group.current) return;

    const t = state.clock.elapsedTime;
    const progress = THREE.MathUtils.clamp((p.age || 0) / Math.max(0.01, p.duration || 1), 0, 1);
    const baseY = getTerrainHeight(p.x, p.z);
    group.current.position.set(p.x, baseY, p.z);
    group.current.visible = true;

    // ph(s,e) — maps overall progress into a sub-phase [0,1]
    const ph  = (s, e) => THREE.MathUtils.clamp((progress - s) / (e - s + 0.0001), 0, 1);
    const eo  = (v) => 1 - (1 - v) * (1 - v);   // ease-out quad
    const ei  = (v) => v * v;                     // ease-in quad
    const pk  = (v) => Math.sin(v * Math.PI);     // 0→peak→0

    // Set opacity on a keyed mesh ref
    const op = (key, val) => {
      const n = r.current[key]; if (!n) return;
      (Array.isArray(n.material) ? n.material : [n.material])
        .forEach(m => { if (m) m.opacity = Math.max(0, Math.min(1, val)); });
    };
    const nodes = effectNodesRef.current || {};
    const opEffect = (name, val) => {
      const node = nodes[name];
      if (!node) return;
      setCloudOpacity(node, Math.max(0, Math.min(1, val)));
    };
    const scaleEffect = (name, scaleMultiplier, yOffset = 0) => {
      const node = nodes[name];
      if (!node) return;
      applyBaseScale(node, scaleMultiplier, yOffset);
    };

    // ── ORBITAL LANCE (7.5s) ─────────────────────────────────────────
    if (p.kind === 'orbital_lance') {
      const d = ph(0, 0.18), imp = ph(0.18, 0.44), lin = ph(0.44, 1);
      const pulse = 0.85 + Math.sin(t * 26) * 0.13;

      // Outer plasma sheath — always full-height, animates in/out by opacity
      op('beam',     d < 1 ? 0.06 + d * 0.16
                   : imp < 1 ? 0.22 + pk(imp) * 0.42
                   : Math.max(0, 0.52 - lin * 0.52));

      // Bright inner beam core — also pulses in width during impact
      const bc = r.current.beamCore;
      if (bc) {
        const bw = (0.8 + pulse * 0.2) * (imp < 1 ? 1 + pk(imp) * 2.8 : 1);
        bc.scale.set(bw, 1, bw);
        op('beamCore', d < 1 ? d * 0.72
                     : imp < 1 ? 0.72 + pk(imp) * 0.26
                     : Math.max(0, 0.82 - lin * 0.82));
      }

      // Impact flash sphere
      const fl = r.current.flash;
      if (fl) {
        fl.scale.setScalar(imp < 1 ? 0.3 + eo(imp) * 5.5 : Math.max(0.1, 5.8 - lin * 5.6));
        op('flash', imp < 1 ? pk(imp) * 0.94 : Math.max(0, 0.14 - lin * 0.14));
      }

      // Ground glow halo
      const gl = r.current.glow;
      if (gl) {
        gl.scale.setScalar(imp < 1 ? 0.8 + eo(imp) * 7.2 : Math.max(0.5, 8.0 - lin * 7.2) + pulse * 0.18);
        op('glow', imp < 1 ? 0.18 + pk(imp) * 0.34 : Math.max(0, 0.40 - lin * 0.40));
      }

      // Ground scorch circle — expands radially (flat, so scale XY local = XZ world)
      const sc = r.current.scorch;
      if (sc) {
        const s = imp < 1 ? eo(imp) : 1;
        sc.scale.set(s, s, 1);
        op('scorch', imp < 1 ? eo(imp) * 0.88 : Math.max(0, 0.88 - lin * 0.14));
      }

      // Inner ring
      const ra = r.current.ringA;
      if (ra) {
        const s = imp < 1 ? 0.4 + eo(imp) * 4.5 : 4.9 + lin * 2.8;
        ra.scale.set(s, s, 1);
        ra.rotation.z += 0.06;
        op('ringA', imp < 1 ? pk(imp) * 0.82 : Math.max(0, 0.44 - lin * 0.44));
      }

      // Outer ring
      const rb = r.current.ringB;
      if (rb) {
        const s = imp < 1 ? 0.5 + eo(imp) * 8.0 : 8.5 + lin * 5.0;
        rb.scale.set(s, s, 1);
        op('ringB', imp < 1 ? pk(imp) * 0.54 : Math.max(0, 0.30 - lin * 0.30));
      }

      scaleEffect('support_orbital_lance_beam', 1 + pulse * 0.05);
      opEffect('support_orbital_lance_beam', d < 1 ? 0.08 + d * 0.18 : imp < 1 ? 0.24 + pk(imp) * 0.34 : Math.max(0, 0.46 - lin * 0.46));
      scaleEffect('support_orbital_lance_core', (0.9 + pulse * 0.1) * (imp < 1 ? 1 + pk(imp) * 0.85 : 1));
      opEffect('support_orbital_lance_core', d < 1 ? d * 0.66 : imp < 1 ? 0.7 + pk(imp) * 0.2 : Math.max(0, 0.8 - lin * 0.8));
      scaleEffect('support_orbital_lance_flare_base', imp < 1 ? 0.4 + eo(imp) * 4.6 : Math.max(0.1, 5.0 - lin * 4.8));
      opEffect('support_orbital_lance_flare_base', imp < 1 ? pk(imp) * 0.88 : Math.max(0, 0.14 - lin * 0.14));
      scaleEffect('support_orbital_lance_impact', 0.7 + eo(imp) * 2.8, imp < 1 ? eo(imp) * 5 : Math.max(0, 5 - lin * 5));
      opEffect('support_orbital_lance_impact', imp < 1 ? 0.18 + pk(imp) * 0.36 : Math.max(0, 0.34 - lin * 0.34));
      scaleEffect('support_orbital_lance_ring_inner', imp < 1 ? 0.5 + eo(imp) * 4.2 : 4.7 + lin * 2.7);
      opEffect('support_orbital_lance_ring_inner', imp < 1 ? pk(imp) * 0.82 : Math.max(0, 0.4 - lin * 0.4));
      scaleEffect('support_orbital_lance_ring_outer', imp < 1 ? 0.6 + eo(imp) * 7.0 : 7.6 + lin * 4.2);
      opEffect('support_orbital_lance_ring_outer', imp < 1 ? pk(imp) * 0.46 : Math.max(0, 0.24 - lin * 0.24));
      scaleEffect('support_orbital_lance_shock', imp < 1 ? 0.65 + eo(imp) * 5.0 : 5.8 + lin * 3.4);
      opEffect('support_orbital_lance_shock', imp < 1 ? pk(imp) * 0.28 : Math.max(0, 0.18 - lin * 0.18));
      scaleEffect('orbital_scorch', imp < 1 ? eo(imp) : 1);
      opEffect('orbital_scorch', imp < 1 ? eo(imp) * 0.76 : Math.max(0, 0.76 - lin * 0.12));
      scaleEffect('orbital_scorch_hot', imp < 1 ? 0.6 + eo(imp) * 1.4 : 2.0 + pulse * 0.1);
      opEffect('orbital_scorch_hot', imp < 1 ? 0.24 + pk(imp) * 0.24 : Math.max(0, 0.3 - lin * 0.3));
      opEffect('support_orbital_lance_flare_top', d < 1 ? d * 0.4 : Math.max(0, 0.4 - progress * 0.4));
    }

    // ── FIRESTORM (10s) ──────────────────────────────────────────────
    else if (p.kind === 'firestorm') {
      const ig = ph(0, 0.10), bl = ph(0.10, 0.40), bu = ph(0.40, 1);
      const pulse = 0.82 + Math.sin(t * 11) * 0.16;

      // Initial white-orange ignition flash
      const fln = r.current.flash;
      if (fln) {
        fln.scale.setScalar(ig < 1 ? 0.6 + eo(ig) * 3.6 : bl < 1 ? 4.2 - bl * 3.4 : 0.8);
        op('flash', ig < 1 ? 0.32 + ig * 0.58 : bl < 1 ? Math.max(0, 0.9 - bl * 0.9) : 0);
      }

      // Central fireball — rises and expands
      const fb = r.current.fireball;
      if (fb) {
        fb.scale.setScalar(ig < 1 ? 0.5 + eo(ig) * 2.5
                          : bl < 1 ? 3.0 + eo(bl) * 4.8 + pulse * 0.28
                          : Math.max(0.2, 7.8 - bu * 7.4) + pulse * 0.22);
        fb.position.y = 8 + pulse * 5 + (bl < 1 ? bl * 18 : 18 + bu * 12);
        op('fireball', ig < 1 ? 0.28 + ig * 0.62 : bl < 1 ? 0.9 - bl * 0.22 : Math.max(0, 0.68 - bu * 0.66));
      }

      // Ground ember glow — flat circle
      const em = r.current.ember;
      if (em) {
        const s = ig < 1 ? ig : bl < 1 ? 1 + bl * 0.42 : Math.max(0.1, 1.42 - bu * 0.38);
        em.scale.set(s, s, 1);
        op('ember', ig < 1 ? ig * 0.72 : bl < 1 ? 0.72 - bl * 0.16 : Math.max(0, 0.56 - bu * 0.46));
      }

      // Ground char — flat circle, expands
      const gc = r.current.char;
      if (gc) {
        const s = bl < 1 ? eo(bl) : 1;
        gc.scale.set(s, s, 1);
        op('char', bl < 1 ? eo(bl) * 0.84 : Math.max(0, 0.84 - bu * 0.16));
      }

      // Fire ring
      const ra = r.current.ringA;
      if (ra) {
        const s = ig < 1 ? 0.4 + ig * 0.9 : bl < 1 ? 1.3 + eo(bl) * 9.5 : 10.8 + bu * 5.0;
        ra.scale.set(s, s, 1);
        ra.rotation.z += 0.04;
        op('ringA', ig < 1 ? 0.18 + ig * 0.42 : bl < 1 ? 0.6 - bl * 0.22 : Math.max(0, 0.38 - bu * 0.38));
      }

      // Shockwave ring — blasts out faster
      const rb = r.current.ringB;
      if (rb) {
        const s = bl < 1 ? 0.6 + eo(bl) * 13.0 : 13.6 + bu * 6.0;
        rb.scale.set(s, s, 1);
        op('ringB', bl < 1 ? pk(bl) * 0.58 : Math.max(0, 0.30 - bu * 0.30));
      }

      // Smoke plume — rises and widens
      const sm = r.current.smoke;
      if (sm) {
        sm.position.y = 20 + (bl < 1 ? bl * 40 : 40 + bu * 72);
        const sw = 0.5 + (bl < 1 ? bl * 1.8 : 1.8 + bu * 3.8);
        const sh = 0.3 + (bl < 1 ? bl * 2.2 : 2.2 + bu * 5.5);
        sm.scale.set(sw, sh, sw);
        op('smoke', bl < 1 ? bl * 0.28 : Math.max(0, 0.32 - bu * 0.30));
      }

      scaleEffect('support_firestorm_core', ig < 1 ? 0.5 + eo(ig) * 2.4 : bl < 1 ? 2.9 + eo(bl) * 3.8 + pulse * 0.2 : Math.max(0.2, 6.9 - bu * 6.5) + pulse * 0.18, bl < 1 ? bl * 18 : 18 + bu * 12);
      opEffect('support_firestorm_core', ig < 1 ? 0.28 + ig * 0.62 : bl < 1 ? 0.9 - bl * 0.22 : Math.max(0, 0.68 - bu * 0.66));
      scaleEffect('support_firestorm_ring', ig < 1 ? 0.5 + ig * 0.9 : bl < 1 ? 1.4 + eo(bl) * 9.2 : 10.6 + bu * 4.8);
      opEffect('support_firestorm_ring', ig < 1 ? 0.22 + ig * 0.36 : bl < 1 ? 0.58 - bl * 0.2 : Math.max(0, 0.36 - bu * 0.36));
      scaleEffect('support_firestorm_shock', bl < 1 ? 0.6 + eo(bl) * 12.4 : 13.0 + bu * 5.6);
      opEffect('support_firestorm_shock', bl < 1 ? pk(bl) * 0.44 : Math.max(0, 0.22 - bu * 0.22));
      scaleEffect('support_firestorm_plume', 0.6 + (bl < 1 ? bl * 1.7 : 1.7 + bu * 3.4), bl < 1 ? bl * 40 : 40 + bu * 72);
      opEffect('support_firestorm_plume', bl < 1 ? bl * 0.24 : Math.max(0, 0.28 - bu * 0.26));
      scaleEffect('firestorm_char_field', bl < 1 ? eo(bl) : 1);
      opEffect('firestorm_char_field', bl < 1 ? eo(bl) * 0.78 : Math.max(0, 0.78 - bu * 0.14));
      scaleEffect('firestorm_ember_field', ig < 1 ? ig : bl < 1 ? 1 + bl * 0.36 : Math.max(0.2, 1.36 - bu * 0.34));
      opEffect('firestorm_ember_field', ig < 1 ? ig * 0.64 : bl < 1 ? 0.64 - bl * 0.12 : Math.max(0, 0.5 - bu * 0.42));
      scaleEffect('firestorm_ground_roll', ig < 1 ? 0.4 + ig * 0.9 : bl < 1 ? 1.4 + bl * 2.0 : Math.max(0.6, 3.4 - bu * 1.8), 3 + pulse * 2);
      opEffect('firestorm_ground_roll', ig < 1 ? 0.18 + ig * 0.22 : Math.max(0, 0.4 - bu * 0.36));
      for (let i = 0; i < 6; i += 1) {
        const flameName = `support_firestorm_flame_${i}`;
        const flame = nodes[flameName];
        if (!flame) continue;
        const flicker = 0.86 + Math.sin(t * (7 + i) + i * 0.7) * 0.18;
        applyBaseScale(flame, (ig < 1 ? 0.4 + ig : 1.3 + (1 - bu * 0.5)) * flicker, bl < 1 ? bl * (12 + i * 1.8) : 12 + i * 1.8 + bu * 8);
        setCloudOpacity(flame, ig < 1 ? ig * 0.44 : bl < 1 ? 0.56 + Math.sin(t * (8 + i)) * 0.08 : Math.max(0, 0.46 - bu * 0.42));
      }
      for (let i = 0; i < 4; i += 1) {
        const smokeName = `support_firestorm_smoke_${i}`;
        const smoke = nodes[smokeName];
        if (!smoke) continue;
        const drift = bl < 1 ? bl * (18 + i * 8) : 18 + i * 8 + bu * (40 + i * 16);
        applyBaseScale(smoke, 0.8 + (bl < 1 ? bl * 0.8 : 0.8 + bu * 1.6), drift);
        smoke.position.x = smoke.userData.basePosition.x + Math.sin(t * (0.7 + i * 0.2)) * (3 + i * 1.5);
        smoke.position.z = smoke.userData.basePosition.z + Math.cos(t * (0.6 + i * 0.18)) * (2.4 + i);
        setCloudOpacity(smoke, bl < 1 ? 0.12 + bl * 0.16 : Math.max(0, 0.28 - bu * 0.24));
      }
    }

    // ── KINETIC SPEAR (6.5s) ─────────────────────────────────────────
    else if (p.kind === 'kinetic_spear') {
      const de = ph(0, 0.38), im = ph(0.38, 0.55), cr = ph(0.55, 1);
      const pulse = 0.88 + Math.sin(t * 22) * 0.10;
      const rodH = 300;

      // Rod tip descends from y=400 → y=0; center is 150 above tip
      const tipY = de < 1 ? 400 - ei(de) * 395
                 : im < 1 ? 5 - eo(im) * 5
                 : 0;

      // Plasma entry sheath around rod
      const sh = r.current.sheath;
      if (sh) {
        sh.position.y = tipY + rodH * 0.5;
        sh.visible = de < 1 || im < 0.65;
        const sw = 1.8 + pulse * 0.18;
        sh.scale.set(sw, 1, sw);
        op('sheath', de < 0.05 ? de * 7
                   : de < 1    ? 0.14 + de * 0.10
                   : im < 1    ? Math.max(0, 0.22 - im * 0.22)
                   : 0);
      }

      // Tungsten rod body
      const rod = r.current.rod;
      if (rod) {
        rod.position.y = tipY + rodH * 0.5;
        rod.visible = de < 1 || im < 0.85;
        op('rod', de < 0.05 ? de * 14
                : de < 1    ? 0.58 - de * 0.14
                : im < 1    ? Math.max(0, 0.72 - im * 0.72)
                : 0);
      }

      // Glowing nose tip
      const ns = r.current.nose;
      if (ns) {
        ns.position.y = tipY + 2;
        ns.visible = de > 0.01 || im < 0.55;
        ns.scale.setScalar(1 + de * 0.5 + pulse * 0.14);
        op('nose', de < 0.05 ? de * 14
                 : de < 1    ? 0.58 + de * 0.32
                 : im < 1    ? Math.max(0, 0.9 - im * 0.9)
                 : 0);
      }

      // Impact flash
      const fl = r.current.flash;
      if (fl) {
        fl.scale.setScalar(im < 1 ? 0.4 + eo(im) * 8.5 : Math.max(0.1, 8.9 - cr * 8.7));
        op('flash', im < 1 ? pk(im) * 0.98 : Math.max(0, 0.20 - cr * 0.20));
      }

      // Crater scorch — flat circle expands
      const cs = r.current.scorch;
      if (cs) {
        const s = im < 1 ? eo(im) : 1;
        cs.scale.set(s, s, 1);
        op('scorch', im < 1 ? eo(im) * 0.92 : Math.max(0, 0.92 - cr * 0.14));
      }

      // Inner shockwave ring
      const ra = r.current.ringA;
      if (ra) {
        const s = im < 1 ? 0.5 + eo(im) * 10.0 : 10.5 + cr * 5.5;
        ra.scale.set(s, s, 1);
        op('ringA', im < 1 ? pk(im) * 0.74 : Math.max(0, 0.44 - cr * 0.44));
      }

      // Outer shockwave ring
      const rb = r.current.ringB;
      if (rb) {
        const s = im < 1 ? 0.6 + eo(im) * 13.5 : 14.1 + cr * 7.5;
        rb.scale.set(s, s, 1);
        op('ringB', im < 1 ? pk(im) * 0.50 : Math.max(0, 0.28 - cr * 0.28));
      }

      const rodScale = 1 + pulse * 0.06;
      scaleEffect('kinetic_plasma_sheath', 1.5 + pulse * 0.16, tipY - 153 + rodH * 0.5);
      opEffect('kinetic_plasma_sheath', de < 0.05 ? de * 6 : de < 1 ? 0.12 + de * 0.1 : im < 1 ? Math.max(0, 0.2 - im * 0.2) : 0);
      scaleEffect('support_kinetic_spear_shaft', rodScale, tipY - 150 + rodH * 0.5);
      opEffect('support_kinetic_spear_shaft', de < 0.05 ? de * 14 : de < 1 ? 0.56 - de * 0.14 : im < 1 ? Math.max(0, 0.7 - im * 0.7) : 0);
      scaleEffect('support_kinetic_spear_tip', 1 + de * 0.44 + pulse * 0.1, tipY - 6);
      opEffect('support_kinetic_spear_tip', de < 0.05 ? de * 14 : de < 1 ? 0.6 + de * 0.28 : im < 1 ? Math.max(0, 0.84 - im * 0.84) : 0);
      scaleEffect('support_kinetic_spear_flare', im < 1 ? 0.4 + eo(im) * 8.0 : Math.max(0.1, 8.4 - cr * 8.2));
      opEffect('support_kinetic_spear_flare', im < 1 ? pk(im) * 0.9 : Math.max(0, 0.18 - cr * 0.18));
      scaleEffect('support_kinetic_spear_impact', 0.7 + eo(im) * 3.0, im < 1 ? eo(im) * 5 : Math.max(0, 5 - cr * 5));
      opEffect('support_kinetic_spear_impact', im < 1 ? 0.16 + pk(im) * 0.28 : Math.max(0, 0.24 - cr * 0.24));
      scaleEffect('support_kinetic_spear_ring', im < 1 ? 0.5 + eo(im) * 9.6 : 10.1 + cr * 5.2);
      opEffect('support_kinetic_spear_ring', im < 1 ? pk(im) * 0.7 : Math.max(0, 0.4 - cr * 0.4));
      scaleEffect('kinetic_ring_outer', im < 1 ? 0.6 + eo(im) * 13.0 : 13.6 + cr * 7.0);
      opEffect('kinetic_ring_outer', im < 1 ? pk(im) * 0.34 : Math.max(0, 0.16 - cr * 0.16));
      scaleEffect('kinetic_crater', im < 1 ? eo(im) : 1);
      opEffect('kinetic_crater', im < 1 ? eo(im) * 0.84 : Math.max(0, 0.84 - cr * 0.14));
      opEffect('kinetic_crater_hot', im < 1 ? pk(im) * 0.8 : Math.max(0, 0.34 - cr * 0.3));
      scaleEffect('kinetic_crater_hot', im < 1 ? 0.6 + eo(im) * 1.6 : 2.2);
      scaleEffect('kinetic_heat_wake', 1.1 + pulse * 0.08, tipY - 72 + 68);
      opEffect('kinetic_heat_wake', de < 1 ? 0.16 + de * 0.12 : Math.max(0, 0.16 - im * 0.16));
    }
  });

  if (!trackedEffect) return null;

  const rf = (key) => (node) => { r.current[key] = node; };
  const kind = trackedEffect.kind;
  const useFallback = !effectScene;

  return (
    <group ref={group} visible={false}>
      {effectScene ? <primitive object={effectScene} /> : null}

      {/* ── ORBITAL LANCE ── electric-blue hypervelocity beam from orbit */}
      {useFallback && kind === 'orbital_lance' && (<>
        {/* Outer plasma sheath — full height column */}
        <mesh ref={rf('beam')} position={[0, 140, 0]}>
          <cylinderGeometry args={[16, 24, 280, 18, 1, true]} />
          <meshBasicMaterial color="#0ea5e9" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Inner beam core */}
        <mesh ref={rf('beamCore')} position={[0, 142, 0]}>
          <cylinderGeometry args={[3.5, 5.5, 285, 12]} />
          <meshBasicMaterial color="#f0f9ff" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Impact flash sphere */}
        <mesh ref={rf('flash')} position={[0, 14, 0]}>
          <sphereGeometry args={[18, 14, 10]} />
          <meshBasicMaterial color="#e0f2fe" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Ground glow halo */}
        <mesh ref={rf('glow')} position={[0, 8, 0]}>
          <sphereGeometry args={[22, 10, 8]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Ground scorch */}
        <mesh ref={rf('scorch')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.3, 0]}>
          <circleGeometry args={[52, 36]} />
          <meshBasicMaterial color="#0c1a2e" transparent opacity={0} depthWrite={false} />
        </mesh>
        {/* Inner ring */}
        <mesh ref={rf('ringA')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.2, 0]}>
          <ringGeometry args={[0.85, 1, 44]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Outer ring */}
        <mesh ref={rf('ringB')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.6, 0]}>
          <ringGeometry args={[0.88, 1, 48]} />
          <meshBasicMaterial color="#7dd3fc" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      </>)}

      {/* ── FIRESTORM ── rolling napalm / incendiary area-denial */}
      {useFallback && kind === 'firestorm' && (<>
        {/* Initial ignition flash */}
        <mesh ref={rf('flash')} position={[0, 10, 0]}>
          <sphereGeometry args={[22, 14, 10]} />
          <meshBasicMaterial color="#fef3c7" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Fireball core — rises as it expands */}
        <mesh ref={rf('fireball')} position={[0, 14, 0]}>
          <sphereGeometry args={[24, 14, 10]} />
          <meshBasicMaterial color="#fed7aa" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Ground ember glow */}
        <mesh ref={rf('ember')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.3, 0]}>
          <circleGeometry args={[36, 28]} />
          <meshBasicMaterial color="#dc2626" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Ground char */}
        <mesh ref={rf('char')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, 0]}>
          <circleGeometry args={[92, 38]} />
          <meshBasicMaterial color="#0c0502" transparent opacity={0} depthWrite={false} />
        </mesh>
        {/* Fire ring */}
        <mesh ref={rf('ringA')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.6, 0]}>
          <ringGeometry args={[0.86, 1, 38]} />
          <meshBasicMaterial color="#f97316" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Shockwave ring */}
        <mesh ref={rf('ringB')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, 0]}>
          <ringGeometry args={[0.90, 1, 44]} />
          <meshBasicMaterial color="#fb923c" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Smoke plume — position.y driven by useFrame */}
        <mesh ref={rf('smoke')} position={[0, 55, 0]}>
          <cylinderGeometry args={[20, 52, 80, 14, 1, true]} />
          <meshBasicMaterial color="#1c1917" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </>)}

      {/* ── KINETIC SPEAR ── tungsten rod from orbit, hypervelocity impact */}
      {useFallback && kind === 'kinetic_spear' && (<>
        {/* Plasma entry sheath — position.y driven by useFrame */}
        <mesh ref={rf('sheath')} position={[0, 330, 0]}>
          <cylinderGeometry args={[10, 18, 300, 14, 1, true]} />
          <meshBasicMaterial color="#f97316" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Tungsten rod body */}
        <mesh ref={rf('rod')} position={[0, 330, 0]}>
          <cylinderGeometry args={[2.8, 4.0, 300, 10]} />
          <meshBasicMaterial color="#f1f5f9" transparent opacity={0} depthWrite={false} />
        </mesh>
        {/* Glowing nose tip */}
        <mesh ref={rf('nose')} position={[0, 400, 0]}>
          <sphereGeometry args={[12, 12, 8]} />
          <meshBasicMaterial color="#fef9c3" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Impact flash */}
        <mesh ref={rf('flash')} position={[0, 14, 0]}>
          <sphereGeometry args={[20, 14, 10]} />
          <meshBasicMaterial color="#f8fafc" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Crater scorch */}
        <mesh ref={rf('scorch')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
          <circleGeometry args={[62, 38]} />
          <meshBasicMaterial color="#0c0a09" transparent opacity={0} depthWrite={false} />
        </mesh>
        {/* Inner shockwave ring */}
        <mesh ref={rf('ringA')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.4, 0]}>
          <ringGeometry args={[0.82, 1, 40]} />
          <meshBasicMaterial color="#bae6fd" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Outer shockwave ring */}
        <mesh ref={rf('ringB')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.6, 0]}>
          <ringGeometry args={[0.88, 1, 48]} />
          <meshBasicMaterial color="#e2e8f0" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      </>)}

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
       // Sink 1 unit into terrain so the foundation base clears the terrain surface
       // (prevents z-fighting / black-square artefact at the pad base)
       group.current.position.set(p.x, (p.y || 0) + recentHit * 0.4 - (isDestroyed ? 2.4 : 1.0), p.z);
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
          {/* Main Vault Dome */}
          <mesh position={[0, 7, -6]} scale={[1.2, 0.82, 1.46]}>
             <sphereGeometry args={[28, 24, 20]} />
             <AliveMaterial color={isCritical ? '#3f2a2a' : isDamaged ? '#475569' : '#4b5563'} roughness={0.95} />
          </mesh>
          <mesh position={[0, 15, -14]} scale={[1.45, 0.72, 1.85]}>
             <sphereGeometry args={[18, 24, 16]} />
             <AliveMaterial color={isCritical ? '#4b3b31' : isDamaged ? '#4b5563' : '#3f4b36'} roughness={1} />
          </mesh>
          {/* Main Bunker Core */}
          <mesh position={[0, 3, 10]}>
             <boxGeometry args={[42, 8, 54]} />
             <AliveMaterial color={isCritical ? '#3f3f46' : '#4b5563'} roughness={0.92} />
          </mesh>
          {/* Bunker entrance tunnel ribs */}
          <mesh position={[0, 11, 24]}>
             <cylinderGeometry args={[16, 16, 26, 16]} rotation={[Math.PI / 2, 0, 0]} />
             <AliveMaterial color={isCritical ? '#4b5563' : '#5b6570'} roughness={0.84} />
          </mesh>
          {/* Bunker outer rim */}
          <mesh position={[0, 11, 31]}>
             <torusGeometry args={[16, 4, 16, 32]} />
             <AliveMaterial color="#23272f" roughness={0.9} />
          </mesh>
          {/* Concrete Sloped Checkpoint */}
          <mesh position={[0, 3, 34]} rotation={[-Math.PI / 8, 0, 0]}>
             <boxGeometry args={[22, 12, 14]} />
             <AliveMaterial color={isCritical ? '#3f1d1d' : '#303845'} roughness={0.9} />
          </mesh>
          {/* Reinforced Side Buttresses */}
          {[[-16, 12, 18], [16, 12, 18]].map((buttress, i) => (
            <mesh key={`vault-buttress-${i}`} position={buttress} rotation={[0.24, 0, 0]}>
               <boxGeometry args={[7, 26, 22]} />
               <AliveMaterial color={isCritical ? '#2a333d' : '#4b5563'} roughness={0.92} />
            </mesh>
          ))}

          <group ref={entryRef} position={[0, 11, 31.5]}>
            {/* Massive Gear Vault Door */}
            <mesh ref={doorRef} rotation={[Math.PI / 2, 0, 0]}>
               <cylinderGeometry args={[11, 11, 4, 32]} />
               <AliveMaterial color={isCritical ? '#64748b' : '#94a3b8'} metalness={0.86} roughness={0.26} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 1.4]}>
               <cylinderGeometry args={[8.6, 8.6, 2.2, 24]} />
               <AliveMaterial color="#475569" metalness={0.78} roughness={0.34} />
            </mesh>
            {[0, 1, 2, 3, 4, 5].map(i => (
               <mesh key={`vault-spoke-${i}`} rotation={[0, 0, (i * Math.PI) / 3]} position={[0, 0, 1.9]}>
                  <boxGeometry args={[17, 1.6, 1.8]} />
                  <AliveMaterial color="#64748b" metalness={0.82} roughness={0.34} />
               </mesh>
            ))}
            <mesh position={[0, 0, 2.3]}>
               <sphereGeometry args={[2.7, 12, 12]} />
               <AliveMaterial color="#e2e8f0" metalness={0.84} roughness={0.2} />
            </mesh>
          </group>

          {/* Exterior Emergency Light Bar */}
          <mesh position={[0, 28, 18]}>
             <boxGeometry args={[32, 2.8, 8]} />
             <AliveMaterial color="#374151" roughness={0.76} metalness={0.2} />
          </mesh>
          {[[-10, 30, 19], [10, 30, 19]].map((light, i) => (
            <mesh key={`vault-light-${i}`} position={light} ref={(el) => { lightRefs.current[i] = el; }}>
               <cylinderGeometry args={[1.5, 1.5, 3.5, 12]} />
               <AliveMaterial color="#f97316" emissive="#fb923c" emissiveIntensity={2.6} />
            </mesh>
          ))}
          {/* Security Guard Rails */}
          {[[-10, 9, 36], [10, 9, 36]].map((rail, i) => (
            <mesh key={`vault-rail-${i}`} position={rail}>
               <boxGeometry args={[2, 8, 2]} />
               <AliveMaterial color="#9ca3af" metalness={0.52} roughness={0.34} />
            </mesh>
          ))}
          <mesh position={[0, 13, 38]}>
             <boxGeometry args={[20, 1, 3]} />
             <AliveMaterial color="#9ca3af" metalness={0.5} roughness={0.38} />
          </mesh>

          {/* Smoke fx */}
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
          {/* Damage decals */}
          {isDamaged && [[-8, 6, 31], [7, 9, 29], [0, 14, 18]].map((scar, i) => (
            <mesh key={`vault-scar-${i}`} position={scar} rotation={[0.2 + i * 0.1, i * 0.55, 0.12]}>
               <boxGeometry args={[8 + i * 2, 0.6, 0.9]} />
               <AliveMaterial color="#3f0d0d" emissive={isCritical ? '#7f1d1d' : '#451a03'} emissiveIntensity={isCritical ? 0.8 : 0.35} roughness={1} />
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
      // Sink 2 units into terrain so the concrete pad bottom clears the terrain surface
      // (prevents z-fighting / black-square artefacts at the pad base)
      group.current.position.set(current.x, current.y - (destroyed ? 3.1 : 2.0), current.z);
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
              {/* Main reactor building */}
              <mesh position={[0, 8, 0]}>
                <boxGeometry args={[34, 16, 28]} />
                <AliveMaterial color="#5a6a7e" roughness={0.8} metalness={0.3} />
              </mesh>
              {/* Sloped buttress front */}
              <mesh position={[0, 4, 18]} rotation={[-0.2, 0, 0]}>
                <boxGeometry args={[30, 8, 12]} />
                <AliveMaterial color="#4b5b70" roughness={0.88} metalness={0.18} />
              </mesh>
              {/* Reactor Core Dome */}
              <mesh position={[0, 16, -2]}>
                <sphereGeometry args={[12, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <AliveMaterial color="#475569" roughness={0.68} metalness={0.6} />
              </mesh>
              {/* Glowing inner reactor ring wrapper */}
              <mesh position={[0, 16.5, -2]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[12.5, 0.8, 16, 32]} />
                <AliveMaterial color="#fcd34d" emissive="#f59e0b" emissiveIntensity={2} roughness={0.2} metalness={0.8} />
              </mesh>
              {/* Cooling Towers */}
              {[[-12, 12, -10], [12, 12, -10]].map((stack, idx) => (
                <group key={`plant-stack-${idx}`} position={stack}>
                  <mesh>
                    <cylinderGeometry args={[2.5, 4, 24, 16]} />
                    <AliveMaterial color="#475569" roughness={0.72} metalness={0.28} />
                  </mesh>
                  {/* Glowing vent at top */}
                  <mesh position={[0, 12.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[1.5, 2.5, 16]} />
                    <AliveMaterial color="#fcd34d" emissive="#f59e0b" emissiveIntensity={1.5} roughness={0.2} />
                  </mesh>
                </group>
              ))}
              {/* Power conduit pipes */}
              {[[-14, 14, 9], [14, 14, 9]].map((tank, idx) => (
                <mesh key={`plant-tank-${idx}`} position={tank} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[3, 3, 12, 12]} />
                  <AliveMaterial color="#64748b" roughness={0.6} metalness={0.38} />
                </mesh>
              ))}
              <pointLight position={[0, 18, -2]} color="#f59e0b" intensity={2.1} distance={120} />
            </group>
          )}
          {isFactory && (
            <group>
              {/* Main assembly hall */}
              <mesh position={[0, 10, 0]}>
                <boxGeometry args={[44, 20, 34]} />
                <AliveMaterial color="#374151" roughness={0.84} metalness={0.26} />
              </mesh>
              {/* Ribbed Industrial Roof */}
              {[[-11, 22, 0], [11, 22, 0]].map((roof, idx) => (
                <mesh key={`factory-roof-${idx}`} position={roof} rotation={[0, 0, Math.PI / 4]}>
                  <cylinderGeometry args={[1, 14, 34, 4]} />
                  <AliveMaterial color="#526377" roughness={0.68} metalness={0.28} />
                </mesh>
              ))}
              {/* Heavy front gate extension */}
              <mesh position={[0, 12, 18]}>
                <boxGeometry args={[28, 14, 12]} />
                <AliveMaterial color="#4a5a70" roughness={0.54} metalness={0.56} />
              </mesh>
              {/* Glowing assembly garage doors */}
              {[-8, 8].map((doorX, idx) => (
                <mesh key={`factory-door-${idx}`} position={[doorX, 6, 24.1]}>
                  <boxGeometry args={[10, 12, 0.4]} />
                  <AliveMaterial color="#fef08a" emissive="#eab308" emissiveIntensity={1.2} roughness={0.2} metalness={0.8} />
                </mesh>
              ))}
              {/* Exhaust stacks */}
              {[[-17, 20, -8], [17, 20, -8], [-17, 20, 8], [17, 20, 8]].map((stack, idx) => (
                <mesh key={`factory-stack-${idx}`} position={stack}>
                  <cylinderGeometry args={[1.5, 2, 8, 16]} />
                  <AliveMaterial color="#526174" roughness={0.7} metalness={0.34} />
                </mesh>
              ))}
              {/* Exterior tank tracks / construction crane rails */}
              {[[-24, 2, 0], [24, 2, 0]].map((track, idx) => (
                <mesh key={`factory-track-${idx}`} position={track}>
                  <boxGeometry args={[4, 4, 38]} />
                  <AliveMaterial color="#4b5563" roughness={0.82} metalness={0.24} />
                </mesh>
              ))}
            </group>
          )}
          {isHospital && (
            <group>
              {/* Modern pristine hospital base */}
              <mesh position={[0, 8, 0]}>
                <boxGeometry args={[34, 16, 30]} />
                <AliveMaterial color="#dbeafe" roughness={0.6} metalness={0.1} />
              </mesh>
              {/* Slanted hospital roof facade */}
              <mesh position={[0, 18, 0]}>
                <cylinderGeometry args={[13, 17, 4, 4]} rotation={[0, Math.PI / 4, 0]} />
                <AliveMaterial color="#bfdbfe" roughness={0.5} metalness={0.2} />
              </mesh>
              {/* Helipad on roof annex */}
              <group position={[0, 14, 18]}>
                <mesh position={[0, 0, 0]}>
                  <boxGeometry args={[24, 12, 24]} />
                  <AliveMaterial color="#f8fafc" roughness={0.78} metalness={0.12} />
                </mesh>
                <mesh position={[0, 6.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[6, 8, 32]} />
                  <AliveMaterial color="#ef4444" roughness={0.8} />
                </mesh>
              </group>
              {/* Diagnostic windows wrapper */}
              <mesh position={[0, 8, 15.2]}>
                <boxGeometry args={[28, 6, 0.5]} />
                <AliveMaterial color="#93c5fd" emissive="#3b82f6" emissiveIntensity={0.8} roughness={0.2} metalness={0.8} />
              </mesh>
              {/* Center Med-Cross */}
              <group position={[0, 16, 15.2]}>
                <mesh>
                  <boxGeometry args={[8, 2.4, 0.4]} />
                  <AliveMaterial color="#fca5a5" emissive="#ef4444" emissiveIntensity={1.5} roughness={0.2} />
                </mesh>
                <mesh>
                  <boxGeometry args={[2.4, 8, 0.4]} />
                  <AliveMaterial color="#fca5a5" emissive="#ef4444" emissiveIntensity={1.5} roughness={0.2} />
                </mesh>
              </group>
              {/* Quarantine triage tents */}
              {[[-18, 6, -12], [18, 6, -12]].map((tent, idx) => (
                <mesh key={`med-tent-${idx}`} position={tent} rotation={[0, idx === 0 ? -0.18 : 0.18, 0]}>
                  <cylinderGeometry args={[5, 5, 12, 16, 1, false, 0, Math.PI]} rotation={[Math.PI / 2, 0, 0]} />
                  <AliveMaterial color="#cbd5e1" roughness={0.92} metalness={0.06} />
                </mesh>
              ))}
            </group>
          )}
          {isLab && (
            <group>
              {/* Sci-Fi Science Dome */}
              <mesh position={[0, 12, 0]}>
                <sphereGeometry args={[16, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <AliveMaterial color="#52647d" roughness={0.48} metalness={0.6} />
              </mesh>
              <mesh position={[0, 6, 0]}>
                <cylinderGeometry args={[16, 18, 12, 32]} />
                <AliveMaterial color="#485a72" roughness={0.66} metalness={0.4} />
              </mesh>
              {/* Attached data center wing */}
              <mesh position={[0, 8, 16]}>
                <boxGeometry args={[26, 14, 12]} />
                <AliveMaterial color="#56687d" roughness={0.56} metalness={0.52} />
              </mesh>
              {/* Sensor mast / Dish Base */}
              <mesh position={[0, 24, 0]}>
                <cylinderGeometry args={[4, 6, 12, 16]} />
                <AliveMaterial color="#5a6a7e" roughness={0.65} metalness={0.36} />
              </mesh>
              <mesh position={[0, 36, 0]}>
                <cylinderGeometry args={[1, 2, 16, 12]} />
                <AliveMaterial color="#64748b" roughness={0.48} metalness={0.62} />
              </mesh>
              {/* Communications array */}
              <group ref={dishRef} position={[0, 30, 0]}>
                <mesh rotation={[-Math.PI / 2.8, 0, 0]}>
                  <cylinderGeometry args={[0.5, 9, 3, 24, 1, false]} />
                  <AliveMaterial color="#cbd5e1" roughness={0.2} metalness={0.9} />
                </mesh>
                <mesh position={[0, 2, -2]}>
                  <sphereGeometry args={[1.5, 12, 12]} />
                  <AliveMaterial color="#22d3ee" emissive="#06b6d4" emissiveIntensity={2.5} />
                </mesh>
                {/* Orbital telemetry ring */}
                <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
                  <torusGeometry args={[10, 0.4, 8, 32]} />
                  <AliveMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={1.5} />
                </mesh>
              </group>
              {/* Sub-surface coolant ring */}
              <mesh position={[0, 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[17, 1, 16, 32]} />
                <AliveMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={1.2} />
              </mesh>
            </group>
          )}
          {isRadar && (
            <group>
              {/* Radar Command Tower */}
              <mesh position={[0, 9, 0]}>
                <cylinderGeometry args={[10, 14, 18, 16]} />
                <AliveMaterial color="#526274" roughness={0.78} metalness={0.28} />
              </mesh>
              {/* Angular support braces */}
              {[[-8, 17, -8], [8, 17, -8], [-8, 17, 8], [8, 17, 8]].map((brace, idx) => (
                <mesh key={`radar-brace-${idx}`} position={brace} rotation={[0, 0, idx < 2 ? -0.16 : 0.16]}>
                  <boxGeometry args={[2.5, 20, 2.5]} />
                  <AliveMaterial color="#94a3b8" roughness={0.48} metalness={0.56} />
                </mesh>
              ))}
              {/* Central Array Mast */}
              <mesh position={[0, 26, 0]}>
                <cylinderGeometry args={[2, 4, 34, 12]} />
                <AliveMaterial color="#5a6a7e" roughness={0.5} metalness={0.65} />
              </mesh>
              {/* Top Sensor bulb */}
              <mesh position={[0, 44, 0]}>
                <sphereGeometry args={[4.5, 16, 16]} />
                <AliveMaterial color="#22d3ee" emissive="#0ea5e9" emissiveIntensity={1.2} roughness={0.28} metalness={0.8} />
              </mesh>
              {/* Spinning dual-dish array */}
              <group ref={radarDishRef} position={[0, 32, 0]} rotation={[0, 0, 0]}>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[11, 1, 8, 32]} />
                  <AliveMaterial color="#cbd5e1" roughness={0.34} metalness={0.72} />
                </mesh>
                <mesh position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[7, 0.6, 6, 24]} />
                  <AliveMaterial color="#94a3b8" roughness={0.4} metalness={0.8} />
                </mesh>
                <mesh position={[0, -5, 0]}>
                  <cylinderGeometry args={[1, 1, 14, 8]} />
                  <AliveMaterial color="#e2e8f0" roughness={0.2} metalness={0.9} />
                </mesh>
              </group>
            </group>
          )}
          {isAA && (
            <group>
              {/* Heavy armored bunker base */}
              <mesh position={[0, 8, 0]}>
                <cylinderGeometry args={[13, 19, 16, 12]} />
                <AliveMaterial color="#4c5f74" roughness={0.84} metalness={0.24} />
              </mesh>
              {/* Concrete foundation ring */}
              <mesh position={[0, 4, 0]}>
                <cylinderGeometry args={[22, 24, 4, 20]} />
                <AliveMaterial color="#67788d" roughness={0.9} metalness={0.05} />
              </mesh>
              {/* Turret pivot ring */}
              <mesh position={[0, 16, 0]}>
                <cylinderGeometry args={[9, 11, 6, 16]} />
                <AliveMaterial color="#5a6a7e" roughness={0.6} metalness={0.54} />
              </mesh>
              {/* Turret assembly */}
              <group ref={aaTurretRef} position={[0, 20, 0]}>
                {/* Turret Head */}
                <mesh>
                  <boxGeometry args={[14, 8, 12]} />
                  <AliveMaterial color="#4a5b71" roughness={0.54} metalness={0.65} />
                </mesh>
                {/* Barrel Housing */}
                <group ref={aaBarrelRef} position={[0, 1, 6]}>
                  <mesh position={[0, 0, 2]}>
                    <boxGeometry args={[6, 3, 12]} />
                    <AliveMaterial color="#55667a" roughness={0.58} metalness={0.66} />
                  </mesh>
                  {/* Quad-Barrels */}
                  {[-2, 2].map(bx => (
                    [-0.8, 0.8].map(by => (
                      <mesh key={`aa-barrel-${bx}-${by}`} position={[bx, by, 6]}>
                        <cylinderGeometry args={[0.4, 0.4, 14, 8]} rotation={[Math.PI / 2, 0, 0]} />
                        <AliveMaterial color="#475569" roughness={0.4} metalness={0.82} />
                      </mesh>
                    ))
                  ))}
                  {/* Barrel vent holes / heat shields */}
                  <mesh position={[0, 0, 9]}>
                    <boxGeometry args={[5.5, 2.5, 4]} />
                    <AliveMaterial color="#3d4f65" roughness={0.8} metalness={0.9} />
                  </mesh>
                </group>
                {/* Radar targeting eye */}
                <mesh position={[0, 2.5, -3]}>
                  <boxGeometry args={[4, 3, 3]} />
                  <AliveMaterial color="#5e7086" emissive="#f43f5e" emissiveIntensity={1.2} />
                </mesh>
              </group>
              {/* Deep protective moat ring */}
              <mesh position={[0, 1.6, 0]}>
                <cylinderGeometry args={[18, 18, 1.6, 24]} />
                <AliveMaterial color="#4a5a6e" roughness={0.95} />
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
          <meshBasicMaterial color={isDestroyed ? '#4a5568' : '#64748b'} transparent opacity={0.2} />
        </mesh>
      ))}
      {isDestroyed && (
        <group>
          <mesh position={[0, 0.8, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[26, 20]} />
            <meshBasicMaterial color="#3a4556" transparent opacity={0.34} />
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
  const godzillaHeadRef = useRef();
  const godzillaTorsoRef = useRef();
  const godzillaPelvisRef = useRef();
  const godzillaChestSeamRef = useRef();
  const godzillaArmRefs = useRef([]);
  const godzillaLegRefs = useRef([]);
  const godzillaTailRefs = useRef([]);
  const godzillaSpineRefs = useRef([]);
  const octopusMantleRef = useRef();
  const octopusMembraneRef = useRef();
  const octopusBeakRef = useRef();
  const octopusTentacleRefs = useRef([]);
  const beetleBodyRef = useRef();
  const beetleElytraRef = useRef();
  const beetleCollarRef = useRef();
  const beetleJawRef = useRef();
  const beetleLegRefs = useRef([]);
  const wyrmHeadRef = useRef();
  const wyrmCrestRef = useRef();
  const wyrmSegmentRefs = useRef([]);
  const wyrmSpineRefs = useRef([]);
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
  const specialAuraOuterRef = useRef();
  const specialAuraInnerRef = useRef();
  const specialAuraCoreRef = useRef();
  const attackFlashRef = useRef();
  const specialOrbRefs = useRef([]);
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
    const clone = cloneNamedGlbGroup(kaijuAssetsAssetCache.scene, kaijuAssetName, { applyAliveShaderToTextured: true });
    clone?.traverse?.((node) => {
      if (node.position && !node.userData.basePosition) node.userData.basePosition = node.position.clone();
      if (node.rotation && !node.userData.baseRotation) node.userData.baseRotation = node.rotation.clone();
      if (node.scale && !node.userData.baseScale) node.userData.baseScale = node.scale.clone();
    });
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
    godzillaPelvisRef.current = nodes.kaiju_godzilla_pelvis || null;
    godzillaTorsoRef.current = nodes.kaiju_godzilla_torso || null;
    godzillaChestSeamRef.current = nodes.kaiju_godzilla_chest_seam || null;
    godzillaHeadRef.current = nodes.kaiju_godzilla_head || null;
    godzillaArmRefs.current = [
      nodes.kaiju_godzilla_arm_0 || null,
      nodes.kaiju_godzilla_arm_1 || null
    ];
    godzillaLegRefs.current = [
      nodes.kaiju_godzilla_leg_0 || null,
      nodes.kaiju_godzilla_leg_1 || null
    ];
    godzillaTailRefs.current = Array.from({ length: 9 }, (_, tailIndex) => nodes[`kaiju_godzilla_tail_${tailIndex}`] || null);
    godzillaSpineRefs.current = Array.from({ length: 8 }, (_, spineIndex) => nodes[`kaiju_godzilla_spine_${spineIndex}`] || null);
    octopusMantleRef.current = nodes.kaiju_octopus_mantle || null;
    octopusMembraneRef.current = nodes.kaiju_octopus_membrane || null;
    octopusBeakRef.current = nodes.kaiju_octopus_beak || null;
    octopusTentacleRefs.current = Array.from({ length: 8 }, (_, tentacleIndex) => nodes[`kaiju_octopus_tentacle_${tentacleIndex}`] || null);
    beetleBodyRef.current = nodes.kaiju_beetle_body || null;
    beetleElytraRef.current = nodes.kaiju_beetle_elytra || null;
    beetleCollarRef.current = nodes.kaiju_beetle_collar || null;
    beetleJawRef.current = nodes.kaiju_beetle_jaw || null;
    beetleLegRefs.current = Array.from({ length: 3 }, (_, row) => ([
      nodes[`kaiju_beetle_leg_${row}_0`] || null,
      nodes[`kaiju_beetle_leg_${row}_1`] || null
    ]));
    wyrmHeadRef.current = nodes.kaiju_wyrm_head || null;
    wyrmCrestRef.current = nodes.kaiju_wyrm_crest || null;
    wyrmSegmentRefs.current = Array.from({ length: 8 }, (_, segmentIndex) => nodes[`kaiju_wyrm_segment_${segmentIndex}`] || null);
    wyrmSpineRefs.current = Array.from({ length: 6 }, (_, spineIndex) => nodes[`kaiju_wyrm_spine_${spineIndex}`] || null);
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
    [specialAuraOuterRef, specialAuraInnerRef, specialAuraCoreRef, attackFlashRef].forEach((ref) => {
      if (ref.current) ref.current.visible = false;
    });
    specialOrbRefs.current.forEach((orb) => {
      if (orb) orb.visible = false;
    });

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
    const effectMeta = getElementMeta(variantTuning.element);
    const frameStep = getFrameScaledStep(delta);
    const baseScale = p.scale || 10;
    const specialEffectKind = p.specialEffectKind || getKaijuSpecialEffectKind(p.variant);

    if (p.specialReleaseAt && now >= p.specialReleaseAt) {
      spawnKaijuChaosBurst(entitiesRef.current, p);
      p.specialReleaseAt = null;
      p.specialChargeStartedAt = null;
      p.specialPulseStartedAt = now;
      p.specialPulseUntil = now + KAIJU_SPECIAL_PULSE_SECONDS;
      p.specialPulseDuration = KAIJU_SPECIAL_PULSE_SECONDS;
    }
    if (p.specialPulseUntil && now >= p.specialPulseUntil) {
      p.specialPulseUntil = null;
      p.specialPulseStartedAt = null;
    }
    if (p.attackPoseUntil && now >= p.attackPoseUntil) {
      p.attackPoseUntil = null;
      p.attackPoseStartedAt = null;
    }
    if (p.smashPoseUntil && now >= p.smashPoseUntil) {
      p.smashPoseUntil = null;
      p.smashPoseStartedAt = null;
    }

    if (p.state === 'dying') {
      p.vx = 0;
      p.vz = 0;
      const groundY = getTerrainHeight(p.x, p.z);
      if (!Number.isFinite(p.y)) {
        p.y = isFlyingVariant ? (p.flightHeight || groundY + 200) : groundY;
      }
      
      const fallSpeed = isFlyingVariant && p.y > groundY + 10 ? 70 : 18;
      p.y -= (delta || 0.016) * fallSpeed;
      
      const deathTiltX = p.deathTiltX ?? 0.24;
      const deathRollZ = p.deathRollZ ?? Math.PI / 2.9;
      group.current.position.set(p.x, p.y, p.z);
      group.current.rotation.y = p.deathYaw ?? p.rotation ?? group.current.rotation.y;
      group.current.rotation.x += (deathTiltX - group.current.rotation.x) * Math.min(1, (delta || 0.016) * 6);
      group.current.rotation.z += (deathRollZ - group.current.rotation.z) * Math.min(1, (delta || 0.016) * 5);
      if (jawRef.current) jawRef.current.rotation.x = Math.PI / 4;
      group.current.scale.set(baseScale, baseScale, baseScale);

      if (p.y < groundY - baseScale * 0.8) {
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
             p.attackPoseStartedAt = now;
             p.attackPoseUntil = now + KAIJU_ATTACK_POSE_SECONDS;
             p.attackPoseDuration = KAIJU_ATTACK_POSE_SECONDS;
             p.attackTelegraphKind = p.variant === 'octopus'
               ? 'ink'
               : p.variant === 'spider'
               ? 'web'
               : p.variant === 'spicie_bird'
               ? 'lightning'
               : p.variant === 'beetle'
               ? 'lightning'
               : 'fire';
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
                if (primaryTarget.hp <= 0) { markStructureBroken(primaryTarget); AudioManager.play('build_destroy'); }
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
             p.smashPoseStartedAt = now;
             p.smashPoseUntil = now + KAIJU_SMASH_POSE_SECONDS;
             p.smashPoseDuration = KAIJU_SMASH_POSE_SECONDS;
             p.attackTelegraphKind = 'smash';
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
                 if (structureTarget.type === 'facility') AudioManager.play('build_destroy');
               } else {
                 structureTarget.dead = true;
               }
             }
          }
       }
    } else {
       // No targets - wander
       const wanderSpeed = 0.5 * kaijuMoveStep * KAIJU_WANDER_MOVE_MULTIPLIER;
       p.wanderSeed = p.wanderSeed || Math.random() * Math.PI * 2;
       const wanderTime = now * 0.35 + p.wanderSeed;
       p.x += Math.sin(wanderTime) * wanderSpeed;
       p.z += Math.cos(wanderTime) * wanderSpeed;
       group.current.rotation.y = wanderTime;
       p.rotation = group.current.rotation.y;
       p.state = 'wandering';
    }

    if (!p.nextRageBurstAt) {
      p.nextRageBurstAt = now + 2.5 + Math.random() * 2;
    }
    if (
      p.state !== 'dying' &&
      now >= p.nextRageBurstAt &&
      !p.specialReleaseAt &&
      !p.specialPulseUntil
    ) {
      p.specialEffectKind = specialEffectKind;
      p.specialChargeStartedAt = now;
      p.specialReleaseAt = now + KAIJU_SPECIAL_WINDUP_SECONDS;
      p.specialWindupDuration = KAIJU_SPECIAL_WINDUP_SECONDS;
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
    group.current.rotation.y = p.rotation ?? group.current.rotation.y;

    const attackPoseProgress = p.attackPoseUntil
      ? THREE.MathUtils.clamp((p.attackPoseUntil - now) / Math.max(0.01, p.attackPoseDuration || KAIJU_ATTACK_POSE_SECONDS), 0, 1)
      : 0;
    const smashPoseProgress = p.smashPoseUntil
      ? THREE.MathUtils.clamp((p.smashPoseUntil - now) / Math.max(0.01, p.smashPoseDuration || KAIJU_SMASH_POSE_SECONDS), 0, 1)
      : 0;
    const specialChargeProgress = p.specialReleaseAt && p.specialChargeStartedAt !== null && p.specialChargeStartedAt !== undefined
      ? THREE.MathUtils.clamp((now - p.specialChargeStartedAt) / Math.max(0.01, p.specialWindupDuration || KAIJU_SPECIAL_WINDUP_SECONDS), 0, 1)
      : 0;
    const specialPulseProgress = p.specialPulseUntil && p.specialPulseStartedAt !== null && p.specialPulseStartedAt !== undefined
      ? THREE.MathUtils.clamp((p.specialPulseUntil - now) / Math.max(0.01, p.specialPulseDuration || KAIJU_SPECIAL_PULSE_SECONDS), 0, 1)
      : 0;
    const specialIntensity = Math.max(specialChargeProgress, specialPulseProgress);
    const motionTarget = THREE.MathUtils.clamp(
      movedDistance * (isFlyingVariant ? 12 : p.variant === 'spider' ? 13 : p.variant === 'octopus' ? 8 : 9)
      + ((p.state === 'hunting' || p.state === 'approaching') ? 0.5 : 0)
      + (attackPoseProgress + smashPoseProgress) * 0.28
      + specialChargeProgress * 0.4,
      0.06,
      isFlyingVariant ? 1.8 : 1.55
    );
    p.motionBlend = THREE.MathUtils.lerp(p.motionBlend || 0, motionTarget, Math.min(1, delta * 4.2));
    p.motionPhase = (p.motionPhase || 0) + delta * (
      1.1 + p.motionBlend * (
        p.variant === 'spider'
          ? 6.4
          : isFlyingVariant
          ? 7.1
          : p.variant === 'octopus'
          ? 4.4
          : p.variant === 'wyrm'
          ? 5.2
          : p.variant === 'beetle'
          ? 4.9
          : 4.2
      )
    );
    const locomotionTime = p.motionPhase;
    const locomotionWave = Math.sin(locomotionTime);
    const locomotionWaveFast = Math.sin(locomotionTime * 2);
    const breathe = Math.sin(now * 2 + (p.motionSeed || 0)) * 0.03;
    const bodyBob = p.variant === 'spider'
      ? Math.abs(locomotionWave) * baseScale / 10.5
      : isFlyingVariant
      ? Math.abs(locomotionWave) * baseScale / 12
      : Math.abs(locomotionWave) * baseScale / 5.6;

    group.current.position.y = p.y + bodyBob * Math.min(1, p.motionBlend + 0.2);
    group.current.scale.set(
      baseScale,
      baseScale * (1 + (p.variant === 'spider' ? breathe * 0.35 : isFlyingVariant ? breathe * 0.22 : breathe) + specialChargeProgress * 0.03),
      baseScale
    );

    group.current.rotation.x = p.variant === 'spider'
      ? 0.025 + locomotionWave * 0.01 + attackPoseProgress * 0.04 + smashPoseProgress * 0.12 + specialChargeProgress * 0.06
      : isFlyingVariant
      ? -0.08 + locomotionWave * 0.022 - attackPoseProgress * 0.05 - smashPoseProgress * 0.08 - specialChargeProgress * 0.04
      : locomotionWave * 0.02 - attackPoseProgress * 0.06 - smashPoseProgress * 0.12 + specialChargeProgress * 0.04;
    group.current.rotation.z = p.variant === 'spider'
      ? locomotionWave * 0.02
      : isFlyingVariant
      ? Math.sin(locomotionTime * 0.8) * 0.02
      : Math.sin(locomotionTime * 0.75) * 0.05;
    if (damageStageLive > 0) {
      const woundShake = Math.sin(now * (damageStageLive >= 2 ? 7.2 : 4.8)) * 0.01 * damageStageLive;
      group.current.rotation.z += woundShake * (p.variant === 'spider' ? 0.8 : 1);
      group.current.rotation.x += damageStageLive >= 2 ? 0.01 + woundShake * 0.4 : 0;
    }

    const jawBase = p.variant === 'beetle' ? 0.18 : p.variant === 'wyrm' ? 0.14 : 0.08;
    if (jawRef.current) {
      const jawOpen = jawBase + p.motionBlend * 0.05 + attackPoseProgress * 0.42 + smashPoseProgress * 0.12 + specialIntensity * 0.52 + Math.sin(now * 5.8) * 0.05;
      jawRef.current.rotation.x = jawOpen;
    }

    if (p.variant === 'godzilla') {
      if (godzillaPelvisRef.current) {
        const basePos = godzillaPelvisRef.current.userData.basePosition;
        const baseRot = godzillaPelvisRef.current.userData.baseRotation;
        if (basePos) godzillaPelvisRef.current.position.y = basePos.y + Math.abs(locomotionWave) * 1.6 - smashPoseProgress * 0.9;
        if (baseRot) godzillaPelvisRef.current.rotation.x = baseRot.x + locomotionWave * 0.04;
      }
      if (godzillaTorsoRef.current) {
        const baseRot = godzillaTorsoRef.current.userData.baseRotation;
        if (baseRot) {
          godzillaTorsoRef.current.rotation.x = baseRot.x + locomotionWave * 0.05 - attackPoseProgress * 0.12 - smashPoseProgress * 0.16 + specialChargeProgress * 0.08;
          godzillaTorsoRef.current.rotation.z = locomotionWaveFast * 0.018;
        }
      }
      if (godzillaHeadRef.current) {
        const baseRot = godzillaHeadRef.current.userData.baseRotation;
        if (baseRot) {
          godzillaHeadRef.current.rotation.x = baseRot.x + locomotionWave * 0.04 + attackPoseProgress * 0.22 + specialIntensity * 0.18;
          godzillaHeadRef.current.rotation.y = Math.sin(locomotionTime * 0.5) * 0.08;
        }
      }
      if (godzillaChestSeamRef.current?.material) {
        godzillaChestSeamRef.current.material.emissiveIntensity = 0.72 + specialChargeProgress * 2.2 + specialPulseProgress * 1.4 + damageStageLive * 0.18;
      }
      godzillaArmRefs.current.forEach((arm, armIndex) => {
        if (!arm) return;
        const side = armIndex === 0 ? -1 : 1;
        const baseRot = arm.userData.baseRotation;
        if (!baseRot) return;
        arm.rotation.x = baseRot.x + locomotionWave * 0.08 - attackPoseProgress * 0.18 + specialChargeProgress * 0.12;
        arm.rotation.z = baseRot.z + side * (locomotionWave * 0.2 + attackPoseProgress * 0.36 + smashPoseProgress * 0.18);
      });
      godzillaLegRefs.current.forEach((leg, legIndex) => {
        if (!leg) return;
        const stride = Math.sin(locomotionTime + legIndex * Math.PI);
        const baseRot = leg.userData.baseRotation;
        if (!baseRot) return;
        leg.rotation.x = baseRot.x + stride * 0.24 + smashPoseProgress * 0.08;
        leg.rotation.z = baseRot.z + stride * (legIndex === 0 ? -0.05 : 0.05);
      });
      godzillaTailRefs.current.forEach((tail, tailIndex) => {
        if (!tail) return;
        const baseRot = tail.userData.baseRotation;
        if (!baseRot) return;
        tail.rotation.y = baseRot.y + Math.sin(locomotionTime * 0.52 - tailIndex * 0.34) * (0.16 + tailIndex * 0.015) + specialPulseProgress * 0.04;
        tail.rotation.x = baseRot.x + Math.cos(locomotionTime * 0.34 - tailIndex * 0.22) * 0.04;
      });
      godzillaSpineRefs.current.forEach((spine, spineIndex) => {
        if (!spine) return;
        const baseRot = spine.userData.baseRotation;
        if (!baseRot) return;
        spine.rotation.z = baseRot.z + Math.sin(locomotionTime * 0.7 + spineIndex * 0.5) * 0.06;
        if (spine.material) spine.material.emissiveIntensity = (spineIndex % 3 === 0 ? 0.7 : 0.2) + specialChargeProgress * 1.4 + specialPulseProgress * 0.8;
      });
    }

    if (p.variant === 'octopus') {
      if (octopusMantleRef.current) {
        const baseScaleNode = octopusMantleRef.current.userData.baseScale;
        const basePos = octopusMantleRef.current.userData.basePosition;
        if (baseScaleNode) {
          octopusMantleRef.current.scale.set(
            baseScaleNode.x * (1 + Math.sin(locomotionTime * 0.55) * 0.04 + specialChargeProgress * 0.06),
            baseScaleNode.y * (1 + Math.cos(locomotionTime * 0.44) * 0.08 + attackPoseProgress * 0.04),
            baseScaleNode.z * (1 + Math.sin(locomotionTime * 0.5) * 0.04)
          );
        }
        if (basePos) octopusMantleRef.current.position.y = basePos.y + Math.abs(locomotionWave) * 1.2;
      }
      if (octopusMembraneRef.current?.material) {
        octopusMembraneRef.current.material.opacity = 0.36 + specialChargeProgress * 0.18 + specialPulseProgress * 0.1;
      }
      if (octopusBeakRef.current) {
        const baseRot = octopusBeakRef.current.userData.baseRotation;
        if (baseRot) octopusBeakRef.current.rotation.x = baseRot.x + attackPoseProgress * 0.3 + smashPoseProgress * 0.14;
      }
      octopusTentacleRefs.current.forEach((tentacle, tentacleIndex) => {
        if (!tentacle) return;
        const baseRot = tentacle.userData.baseRotation;
        if (!baseRot) return;
        const sweep = Math.sin(locomotionTime * 0.92 + tentacleIndex * 0.75);
        tentacle.rotation.x = baseRot.x + sweep * 0.18 + smashPoseProgress * 0.05;
        tentacle.rotation.y = baseRot.y + Math.cos(locomotionTime * 0.5 + tentacleIndex * 0.6) * 0.16 + specialChargeProgress * 0.12;
        tentacle.rotation.z = sweep * 0.05;
      });
    }

    if (p.variant === 'spider') {
      const crawlSpeed = THREE.MathUtils.clamp(p.motionBlend * 2.4 + (p.state === 'hunting' || p.state === 'approaching' ? 1.1 : 0.45), 0.45, 2.8);
      const crawlTime = locomotionTime * crawlSpeed;
      const attackSpread = attackPoseProgress * 0.22 + specialChargeProgress * 0.2 + specialPulseProgress * 0.16;
      const crouchAmount = smashPoseProgress > 0
        ? 1
        : attackPoseProgress > 0
        ? 0.78
        : p.state === 'hunting' || p.state === 'approaching'
        ? 0.52
        : 0.28;

      if (spiderRootRef.current) {
        spiderRootRef.current.position.y = 4.8 - crouchAmount * 1.6 + Math.abs(Math.sin(crawlTime * 0.55)) * 0.35;
        spiderRootRef.current.rotation.x = 0.06 + crouchAmount * 0.08 + Math.sin(crawlTime * 0.32) * 0.02 + specialChargeProgress * 0.04;
      }
      if (spiderAbdomenRef.current) {
        spiderAbdomenRef.current.position.y = 15.3 + Math.sin(crawlTime * 0.42 + 0.8) * 0.65;
        spiderAbdomenRef.current.rotation.x = -0.16 + Math.sin(crawlTime * 0.34 + 0.5) * 0.05 - specialChargeProgress * 0.04;
        spiderAbdomenRef.current.rotation.z = Math.sin(crawlTime * 0.45) * 0.025;
      }
      if (spiderThoraxRef.current) {
        spiderThoraxRef.current.rotation.x = 0.08 + Math.sin(crawlTime * 0.5) * 0.02 + attackPoseProgress * 0.05;
      }
      if (spiderHeadRef.current) {
        spiderHeadRef.current.rotation.x = -0.08 + crouchAmount * 0.12 + Math.sin(crawlTime * 0.62) * 0.025 + specialChargeProgress * 0.08;
      }
      spiderPedipalpRefs.current.forEach((pedipalp, index) => {
        if (!pedipalp) return;
        const side = index === 0 ? -1 : 1;
        pedipalp.rotation.x = 0.38 + crouchAmount * 0.16 + Math.sin(crawlTime * 0.85 + index * 0.9) * 0.08 + specialPulseProgress * 0.08;
        pedipalp.rotation.z = side * (-0.28 - attackSpread * 0.35);
      });
      spiderLegRefs.current.forEach((leg, legIndex) => {
        if (!leg) return;
        const config = spiderLegConfigs[legIndex];
        if (!config) return;
        const step = Math.sin(crawlTime + config.phase);
        const plant = Math.cos(crawlTime + config.phase * 0.6);
        const limp = damageStageLive >= 2 && (legIndex === 1 || legIndex === 6) ? damageStageLive * 0.1 : 0;
        if (leg.upper) {
          leg.upper.rotation.y = config.yaw + config.stride * step;
          leg.upper.rotation.z = config.side * (config.splay + config.lift * Math.max(0, step) + attackSpread - limp);
        }
        if (leg.mid) {
          leg.mid.rotation.z = config.side * (-0.9 - config.lift * 0.8 * Math.max(0, -step) + limp * 0.7);
          leg.mid.rotation.x = -0.1 + Math.abs(step) * 0.08 + specialChargeProgress * 0.04;
        }
        if (leg.lower) {
          leg.lower.rotation.z = config.side * (0.84 + config.lift * 0.55 * Math.max(0, step) + limp + specialPulseProgress * 0.08);
          leg.lower.rotation.x = 0.12 + Math.max(0, plant) * 0.06;
        }
      });
    }

    if (p.variant === 'beetle') {
      if (beetleBodyRef.current) {
        const baseRot = beetleBodyRef.current.userData.baseRotation;
        if (baseRot) beetleBodyRef.current.rotation.x = baseRot.x + locomotionWave * 0.08 + smashPoseProgress * 0.05;
      }
      if (beetleElytraRef.current) {
        const baseRot = beetleElytraRef.current.userData.baseRotation;
        if (baseRot) beetleElytraRef.current.rotation.x = baseRot.x + attackPoseProgress * 0.12 + specialChargeProgress * 0.18;
      }
      if (beetleCollarRef.current) {
        const baseRot = beetleCollarRef.current.userData.baseRotation;
        if (baseRot) beetleCollarRef.current.rotation.x = baseRot.x + Math.sin(locomotionTime * 0.7) * 0.05;
      }
      if (beetleJawRef.current) {
        const baseRot = beetleJawRef.current.userData.baseRotation;
        if (baseRot) {
          beetleJawRef.current.rotation.x = baseRot.x + attackPoseProgress * 0.18 + specialChargeProgress * 0.12;
          beetleJawRef.current.rotation.y = Math.sin(locomotionTime * 0.4) * 0.06;
        }
      }
      beetleLegRefs.current.forEach((pair, row) => {
        pair.forEach((leg, legIndex) => {
          if (!leg) return;
          const baseRot = leg.userData.baseRotation;
          if (!baseRot) return;
          const side = legIndex === 0 ? -1 : 1;
          const step = Math.sin(locomotionTime * 1.15 + row * 0.72 + legIndex * Math.PI);
          leg.rotation.x = baseRot.x + Math.abs(step) * 0.12;
          leg.rotation.z = baseRot.z + side * (step * 0.2 - specialChargeProgress * 0.08);
        });
      });
    }

    if (p.variant === 'wyrm') {
      wyrmSegmentRefs.current.forEach((segment, segmentIndex) => {
        if (!segment) return;
        const basePos = segment.userData.basePosition;
        const baseRot = segment.userData.baseRotation;
        const wave = Math.sin(locomotionTime * 0.88 - segmentIndex * 0.42);
        if (basePos) {
          segment.position.x = basePos.x + wave * (2.2 + segmentIndex * 0.4);
          segment.position.y = basePos.y + Math.abs(wave) * 0.65;
        }
        if (baseRot) {
          segment.rotation.y = baseRot.y + wave * 0.16;
          segment.rotation.x = baseRot.x + Math.cos(locomotionTime * 0.52 - segmentIndex * 0.28) * 0.04;
        }
      });
      wyrmSpineRefs.current.forEach((spine, spineIndex) => {
        if (!spine) return;
        const baseRot = spine.userData.baseRotation;
        if (baseRot) spine.rotation.z = baseRot.z + Math.sin(locomotionTime * 0.9 + spineIndex * 0.45) * 0.08;
        if (spine.material) spine.material.emissiveIntensity = 0.34 + specialChargeProgress * 1.1 + specialPulseProgress * 0.6;
      });
      if (wyrmHeadRef.current) {
        const baseRot = wyrmHeadRef.current.userData.baseRotation;
        if (baseRot) {
          wyrmHeadRef.current.rotation.x = baseRot.x + attackPoseProgress * 0.16 + specialChargeProgress * 0.12 + Math.sin(locomotionTime * 0.6) * 0.05;
          wyrmHeadRef.current.rotation.y = Math.sin(locomotionTime * 0.42) * 0.09;
        }
      }
      if (wyrmCrestRef.current?.material) {
        wyrmCrestRef.current.material.emissiveIntensity = 0.34 + specialChargeProgress * 1.3 + specialPulseProgress * 0.7;
      }
    }

    if (p.variant === 'spicie_bird') {
      const flapSpeed = THREE.MathUtils.clamp(p.motionBlend * 2.8 + (p.state === 'hunting' || p.state === 'approaching' ? 2.4 : 1.5), 1.2, 4.6);
      const flap = Math.sin(locomotionTime * flapSpeed);
      const glide = Math.sin(now * 1.4 + (p.flightPhase || 0)) * 0.04;
      if (birdRootRef.current) {
        birdRootRef.current.position.y = 12 + Math.abs(flap) * 1.2;
        birdRootRef.current.rotation.x = -0.08 + glide - attackPoseProgress * 0.06 - specialChargeProgress * 0.08;
      }
      if (birdLeftWingRef.current) {
        birdLeftWingRef.current.rotation.z = -0.38 + flap * (0.78 + specialChargeProgress * 0.18) - specialPulseProgress * 0.12;
        birdLeftWingRef.current.rotation.y = -0.08 + flap * 0.06;
      }
      if (birdRightWingRef.current) {
        birdRightWingRef.current.rotation.z = 0.38 - flap * (0.78 + specialChargeProgress * 0.18) + specialPulseProgress * 0.12;
        birdRightWingRef.current.rotation.y = 0.08 - flap * 0.06;
      }
      if (birdTailRef.current) {
        birdTailRef.current.rotation.x = 0.3 + Math.sin(now * 2.1) * 0.08 + specialChargeProgress * 0.08;
      }
      if (birdHeadRef.current) {
        birdHeadRef.current.rotation.x = 0.12 + Math.sin(now * 2.7) * 0.07 + attackPoseProgress * 0.12 + specialChargeProgress * 0.16;
      }
    }

    const specialColor = effectMeta.color || '#cbd5e1';
    const attackColor = p.attackTelegraphKind === 'ink'
      ? '#7c3aed'
      : p.attackTelegraphKind === 'web'
      ? '#dbeafe'
      : p.attackTelegraphKind === 'lightning'
      ? '#67e8f9'
      : p.attackTelegraphKind === 'smash'
      ? '#fb923c'
      : specialEffectKind === 'ash'
      ? '#84cc16'
      : '#f59e0b';
    if (specialAuraOuterRef.current?.material && specialAuraInnerRef.current?.material && specialAuraCoreRef.current?.material) {
      const auraVisible = specialIntensity > 0.01;
      const outerScale = 1 + specialChargeProgress * 1.4 + specialPulseProgress * 0.5;
      specialAuraOuterRef.current.visible = auraVisible;
      specialAuraInnerRef.current.visible = auraVisible;
      specialAuraCoreRef.current.visible = auraVisible;
      specialAuraOuterRef.current.scale.set(outerScale, outerScale, outerScale);
      specialAuraInnerRef.current.scale.set(0.92 + specialChargeProgress * 0.75, 0.92 + specialChargeProgress * 0.75, 1);
      specialAuraCoreRef.current.scale.setScalar(0.85 + specialIntensity * 0.65);
      [specialAuraOuterRef.current, specialAuraInnerRef.current, specialAuraCoreRef.current].forEach((mesh) => {
        mesh.material.color.set(mesh === specialAuraCoreRef.current ? attackColor : specialColor);
      });
      specialAuraOuterRef.current.material.opacity = specialChargeProgress * 0.4 + specialPulseProgress * 0.26;
      specialAuraInnerRef.current.material.opacity = specialChargeProgress * 0.26 + specialPulseProgress * 0.18;
      specialAuraCoreRef.current.material.opacity = specialChargeProgress * 0.18 + specialPulseProgress * 0.14;
      specialAuraCoreRef.current.position.y = 18 + Math.sin(now * 8) * 1.6;
    }
    specialOrbRefs.current.forEach((orb, orbIndex) => {
      if (!orb?.material) return;
      const auraVisible = specialIntensity > 0.01;
      orb.visible = auraVisible;
      if (!auraVisible) return;
      const angle = now * (2.2 + orbIndex * 0.18) + (orbIndex / Math.max(1, specialOrbRefs.current.length)) * Math.PI * 2;
      const radius = 16 + specialChargeProgress * 12 + (orbIndex % 2) * 4;
      orb.position.set(Math.cos(angle) * radius, 12 + Math.sin(now * 3.2 + orbIndex) * 4, Math.sin(angle) * radius);
      orb.scale.setScalar(0.9 + specialIntensity * 0.5 + (orbIndex % 3) * 0.08);
      orb.material.color.set(attackColor);
      orb.material.opacity = 0.14 + specialIntensity * 0.38;
    });
    if (attackFlashRef.current?.material) {
      const attackFlashIntensity = Math.max(attackPoseProgress, smashPoseProgress * 0.9, specialPulseProgress * 0.4);
      attackFlashRef.current.visible = attackFlashIntensity > 0.01;
      attackFlashRef.current.position.set(
        0,
        p.variant === 'spider' ? 14 : p.variant === 'spicie_bird' ? 20 : p.variant === 'octopus' ? 14 : 24,
        p.variant === 'spider' ? 16 : p.variant === 'spicie_bird' ? 22 : p.variant === 'wyrm' ? 20 : 18
      );
      attackFlashRef.current.scale.setScalar(0.9 + attackFlashIntensity * 1.6);
      attackFlashRef.current.material.color.set(attackColor);
      attackFlashRef.current.material.opacity = attackFlashIntensity * 0.42;
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

      <group>
        <mesh ref={specialAuraOuterRef} visible={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, 2.5, 0]}>
          <ringGeometry args={[18, 28, 32]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh ref={specialAuraInnerRef} visible={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, 3.1, 0]}>
          <ringGeometry args={[8, 16, 24]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh ref={specialAuraCoreRef} visible={false} position={[0, 18, 0]}>
          <sphereGeometry args={[6, 12, 12]} />
          <meshBasicMaterial color="#fb923c" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        {[0, 1, 2, 3].map((orbIndex) => (
          <mesh
            key={`kaiju-special-orb-${orbIndex}`}
            ref={(el) => { specialOrbRefs.current[orbIndex] = el; }}
            visible={false}
          >
            <sphereGeometry args={[1.8 + (orbIndex % 2) * 0.35, 8, 8]} />
            <meshBasicMaterial color="#fde047" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        ))}
        <mesh ref={attackFlashRef} visible={false}>
          <sphereGeometry args={[4.2, 10, 10]} />
          <meshBasicMaterial color="#fb923c" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>

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
const MemoEntityWarthog = memo(EntityWarthog);
const MemoEntityMissile = memo(EntityMissile);
const MemoEntityMissileImpact = memo(EntityMissileImpact);
const MemoEntityImpactPuff = memo(EntityImpactPuff);
const MemoEntityPlane = memo(EntityPlane);
const MemoEntityBomb = memo(EntityBomb);
const MemoEntitySupportStrikeEffect = memo(EntitySupportStrikeEffect);
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
        if (p.type === 'support_fx') return <MemoEntitySupportStrikeEffect key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'kaiju') return <MemoEntityKaiju key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} frameSnapshotRef={frameSnapshotRef} setGameState={setGameState} />;
        if (p.type === 'mushroom') return <EntityMushroomCloud key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'kaiju_attack') return <MemoEntityKaijuAttack key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'firebreath') return <MemoEntityFireBreath key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'bullet') return <MemoEntityBullet key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'shell') return <MemoEntityShell key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'jet') return <MemoEntityJet key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'warthog') return <MemoEntityWarthog key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'missile') return <MemoEntityMissile key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'missile_impact') return <MemoEntityMissileImpact key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'impact_puff') return <MemoEntityImpactPuff key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'soldier') return <EntitySoldierGLB key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'tank') return <EntityTank key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} frameSnapshotRef={frameSnapshotRef} />;
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
    loadWorldPropsAsset().catch(() => {});
    loadAirstrikeAsset().catch(() => {});
    loadBaseStructuresAsset().catch(() => {});
    loadKaijuAssetsAsset().catch(() => {});
    loadHumanUnitsAsset().catch(() => {});
    loadCommandEffectsAsset().catch(() => {}); // Pre-warm orbital lance / firestorm / kinetic spear GLB
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

const VillageScene = ({ themeConfig, environmentVariant, setNukeCount, setGameState, pollution, qualityProfile }) => {
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
    armedSupportKey: null,
    supportCooldowns: createDefaultSupportCooldownMap(),
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
  const selectionRef = useRef({
    active: false,
    moved: false,
    startClientX: 0,
    startClientY: 0,
    endClientX: 0,
    endClientY: 0
  });
  const selectedUnitIdsRef = useRef(new Set());
  const selectedProductionBuildingIdRef = useRef(null);
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
  const getProductionFacilities = () => (
    frameSnapshotRef.current.ready
      ? frameSnapshotRef.current.liveFacilities.filter((entity) => !entity.constructing && !isBrokenStructure(entity) && !entity.dead)
      : entitiesRef.current.filter((entity) => entity.type === 'facility' && !entity.dead && !entity.constructing && !isBrokenStructure(entity))
  );
  const syncSelectedProductionBuildingMeta = () => {
    if (typeof window === 'undefined') return;
    const entity = selectedProductionBuildingIdRef.current
      ? entityLookupRef.current.get(selectedProductionBuildingIdRef.current)
      : null;
    const valid = entity && entity.type === 'facility' && !entity.dead && !entity.constructing && !isBrokenStructure(entity);
    if (!valid) {
      selectedProductionBuildingIdRef.current = null;
      window._falloutSelectedProductionBuilding = null;
      return;
    }
    const interaction = getFacilityInteractionOption(entity.kind);
    const now = Date.now();
    window._falloutSelectedProductionBuilding = {
      id: entity.id,
      kind: entity.kind,
      label: BUILD_OPTIONS[entity.kind]?.label || entity.kind,
      icon: BUILD_OPTIONS[entity.kind]?.icon || '🏗️',
      units: BUILDING_DEPLOY_OPTIONS[entity.kind] || [],
      queue: Array.isArray(entity.productionQueue) ? entity.productionQueue.map((job) => job.unitType) : [],
      trainingUnitType: entity.trainingUnitType || null,
      trainingProgress: entity.trainingProgress || 0,
      action: interaction ? {
        label: interaction.label,
        tag: interaction.tag,
        cost: interaction.cost,
        description: interaction.description,
        ready: (entity.abilityCooldownUntil || 0) <= now,
        cooldownRemaining: Math.max(0, (entity.abilityCooldownUntil || 0) - now),
        activeRemaining: Math.max(0, (entity.abilityActiveUntil || 0) - now)
      } : null
    };
  };
  const clearSelectedProductionBuilding = () => {
    selectedProductionBuildingIdRef.current = null;
    syncSelectedProductionBuildingMeta();
  };
  const setSelectedProductionBuilding = (entity) => {
    if (!entity || entity.type !== 'facility' || entity.constructing || entity.dead || isBrokenStructure(entity)) {
      clearSelectedProductionBuilding();
      return;
    }
    selectedProductionBuildingIdRef.current = entity.id;
    syncSelectedProductionBuildingMeta();
  };
  const getSelectedProductionBuilding = () => {
    const entity = selectedProductionBuildingIdRef.current
      ? entityLookupRef.current.get(selectedProductionBuildingIdRef.current)
      : null;
    return entity && entity.type === 'facility' && !entity.dead && !entity.constructing && !isBrokenStructure(entity)
      ? entity
      : null;
  };
  const getProductionSourceForUnit = (unitType, preferredBuildingId = null) => {
    const allowedKinds = getProductionSourcesForUnit(unitType);
    if (!allowedKinds.length) return getBestDeployBunker();
    const facilities = getProductionFacilities();
    if (preferredBuildingId) {
      const preferred = facilities.find((entity) => entity.id === preferredBuildingId && allowedKinds.includes(entity.kind));
      if (preferred) return preferred;
    }
    const selectedBuilding = getSelectedProductionBuilding();
    if (selectedBuilding && allowedKinds.includes(selectedBuilding.kind)) return selectedBuilding;
    const nearestBunker = getBestDeployBunker();
    if (!nearestBunker) return facilities.find((entity) => allowedKinds.includes(entity.kind)) || null;
    const ranked = facilities
      .filter((entity) => allowedKinds.includes(entity.kind))
      .sort((a, b) => (
        Math.hypot((a.x || 0) - nearestBunker.x, (a.z || 0) - nearestBunker.z)
        - Math.hypot((b.x || 0) - nearestBunker.x, (b.z || 0) - nearestBunker.z)
      ));
    return ranked[0] || null;
  };
  const getFacilityDeployTarget = (sourceFacility) => {
    const closestKaiju = getAliveKaijus().sort((a, b) => (
      Math.hypot((a.x || 0) - sourceFacility.x, (a.z || 0) - sourceFacility.z)
      - Math.hypot((b.x || 0) - sourceFacility.x, (b.z || 0) - sourceFacility.z)
    ))[0];
    if (closestKaiju) return clampStrikeTarget({ x: closestKaiju.x, z: closestKaiju.z });
    const entry = getVaultEntryPoint(sourceFacility);
    return clampStrikeTarget({ x: entry.x, z: entry.z - 160 });
  };
  const enqueueFacilityProduction = (facility, unitType) => {
    if (!facility || facility.type !== 'facility') return false;
    facility.productionQueue = Array.isArray(facility.productionQueue) ? facility.productionQueue : [];
    facility.productionQueue.push({
      id: `${unitType}-queue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      unitType,
      duration: DEPLOY_TRAINING_DURATIONS[unitType] || 5.5
    });
    if (!facility.trainingUnitType) {
      const nextJob = facility.productionQueue[0];
      facility.trainingUnitType = nextJob?.unitType || null;
      facility.trainingRemaining = nextJob?.duration || 0;
      facility.trainingProgress = 0;
    }
    syncSelectedProductionBuildingMeta();
    return true;
  };
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

    if (selectedUnitIdsRef.current.size) {
      let changed = false;
      selectedUnitIdsRef.current.forEach((id) => {
        const entity = entityLookupRef.current.get(id);
        if (!isCommandableUnit(entity)) {
          selectedUnitIdsRef.current.delete(id);
          changed = true;
        }
      });
      if (changed) syncSelectedUnitsMeta();
    }
    if (selectedProductionBuildingIdRef.current) {
      const selectedFacility = entityLookupRef.current.get(selectedProductionBuildingIdRef.current);
      if (!selectedFacility || selectedFacility.type !== 'facility' || selectedFacility.dead || selectedFacility.constructing || isBrokenStructure(selectedFacility)) {
        clearSelectedProductionBuilding();
      } else {
        syncSelectedProductionBuildingMeta();
      }
    }

    return snapshot;
  };
  const syncSelectionOverlay = () => {
    if (typeof window === 'undefined') return;
    if (!selectionRef.current.active) {
      window._falloutSelectionBox = null;
      return;
    }
    const { startClientX, startClientY, endClientX, endClientY, moved } = selectionRef.current;
    if (!moved) {
      window._falloutSelectionBox = null;
      return;
    }
    const left = Math.min(startClientX, endClientX);
    const top = Math.min(startClientY, endClientY);
    window._falloutSelectionBox = {
      left,
      top,
      width: Math.abs(endClientX - startClientX),
      height: Math.abs(endClientY - startClientY)
    };
  };
  const syncSelectedUnitsMeta = () => {
    if (typeof window === 'undefined') return;
    window._falloutSelectedUnitIds = Array.from(selectedUnitIdsRef.current);
    window._falloutSelectedUnitCount = selectedUnitIdsRef.current.size;
  };
  const clearUnitSelection = () => {
    entitiesRef.current.forEach((entity) => {
      if (isCommandableUnit(entity)) entity.selected = false;
    });
    selectedUnitIdsRef.current.clear();
    syncSelectedUnitsMeta();
    if (typeof window !== 'undefined') {
      window._falloutGroupCommandTarget = null;
      window._falloutUnitCommandMarkers = [];
    }
  };
  const setSelectedUnits = (entities, additive = false) => {
    const selectedIds = new Set(additive ? selectedUnitIdsRef.current : []);
    if (!additive) {
      entitiesRef.current.forEach((entity) => {
        if (isCommandableUnit(entity)) entity.selected = false;
      });
    }
    entities.forEach((entity) => {
      if (!isCommandableUnit(entity)) return;
      entity.selected = true;
      selectedIds.add(entity.id);
    });
    entitiesRef.current.forEach((entity) => {
      if (!isCommandableUnit(entity)) return;
      if (!selectedIds.has(entity.id)) entity.selected = false;
    });
    selectedUnitIdsRef.current = selectedIds;
    syncSelectedUnitsMeta();
    if (typeof window !== 'undefined' && selectedIds.size < 2) window._falloutGroupCommandTarget = null;
  };
  const getSelectedUnits = () => (
    entitiesRef.current.filter((entity) => isCommandableUnit(entity) && selectedUnitIdsRef.current.has(entity.id))
  );
  const getUnitsForControlGroup = (groupKey = 'all') => {
    if (groupKey === 'armor') return entitiesRef.current.filter((entity) => entity.type === 'tank' && !entity.dead);
    if (groupKey === 'engineers') return entitiesRef.current.filter((entity) => entity.type === 'soldier' && !entity.dead && entity.weaponType === 'engineer');
    if (groupKey === 'squads') return entitiesRef.current.filter((entity) => entity.type === 'soldier' && !entity.dead && entity.weaponType !== 'engineer');
    return entitiesRef.current.filter((entity) => isCommandableUnit(entity) && !entity.dead);
  };
  const projectEntityToClient = (entity, canvasRect) => {
    if (!entity || !canvasRect) return null;
    const vec = new THREE.Vector3(entity.x || 0, (entity.y || 0) + (entity.type === 'tank' ? 22 : 16), entity.z || 0);
    vec.project(camera);
    if (vec.z < -1 || vec.z > 1) return null;
    return {
      x: canvasRect.left + ((vec.x + 1) * 0.5) * canvasRect.width,
      y: canvasRect.top + ((-vec.y + 1) * 0.5) * canvasRect.height
    };
  };
  const getClosestProjectedEntity = (clientX, clientY, entities, canvasRect, maxDistance = 28) => {
    let closest = null;
    let closestDist = maxDistance;
    entities.forEach((entity) => {
      const point = projectEntityToClient(entity, canvasRect);
      if (!point) return;
      const dist = Math.hypot(point.x - clientX, point.y - clientY);
      if (dist <= closestDist) {
        closestDist = dist;
        closest = entity;
      }
    });
    return closest;
  };
  const getSelectionBoxUnits = (canvasRect) => {
    const { startClientX, startClientY, endClientX, endClientY } = selectionRef.current;
    const minX = Math.min(startClientX, endClientX);
    const maxX = Math.max(startClientX, endClientX);
    const minY = Math.min(startClientY, endClientY);
    const maxY = Math.max(startClientY, endClientY);
    return entitiesRef.current.filter((entity) => {
      if (!isCommandableUnit(entity)) return false;
      const point = projectEntityToClient(entity, canvasRect);
      return !!point && point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
    });
  };
  const issueGroupMoveOrder = (units, target, options = {}) => {
    if (!units.length || !target) return;
    const heading = 0;
    if (typeof window !== 'undefined') {
      window._falloutGroupCommandTarget = {
        x: target.x,
        z: target.z,
        at: Date.now()
      };
    }
    const markers = [];
    units.forEach((unit, index) => {
      const row = Math.floor(index / 4);
      const col = index % 4;
      const centeredCol = col - Math.min(3, units.length - 1) / 2;
      const offsetX = centeredCol * 22;
      const offsetZ = row * 20;
      const slotTarget = {
        x: target.x + Math.cos(heading) * offsetX - Math.sin(heading) * offsetZ,
        z: target.z + Math.sin(heading) * offsetX + Math.cos(heading) * offsetZ
      };
      if (options.attackMove) issueAttackMoveOrder(unit, slotTarget);
      else issueMoveOrder(unit, slotTarget);
      markers.push({
        id: unit.id,
        x: slotTarget.x,
        z: slotTarget.z,
        at: Date.now(),
        type: options.attackMove ? 'attack_move' : 'move'
      });
    });
    if (typeof window !== 'undefined') window._falloutUnitCommandMarkers = markers;
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
  const getLiveFacilityBuildState = () => {
    const nextState = cloneDefaultBuildings();
    entitiesRef.current.forEach((entity) => {
      if (entity?.type !== 'facility' || entity.dead || entity.constructing || isBrokenStructure(entity)) return;
      nextState[entity.kind] = true;
    });
    return nextState;
  };
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
      if (entity.type === 'facility' && (entity.dead || entity.constructing || isBrokenStructure(entity))) return false;
      if (entity.type === 'bunker' && (entity.dead || isBrokenStructure(entity))) return false;
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
    if (getLiveFacilityBuildState()[buildingKey]) return false;
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
    const attackTarget = getAliveKaijus().sort((a, b) => (
      Math.hypot((a.x || 0) - target.x, (a.z || 0) - target.z)
      - Math.hypot((b.x || 0) - target.x, (b.z || 0) - target.z)
    ))[0] || null;
    for (let i = 0; i < 4; i++) {
      const soldier = applySoldierTrainingBonuses(
        createSoldierReinforcement(`soldier-deploy-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`, bunker, i),
        economyRef.current.upgrades
      );
      soldier.vx = Math.cos(angle) * (soldier.combatSpeed || 2.6) * SOLDIER_MOVE_SPEED_MULTIPLIER;
      soldier.vz = Math.sin(angle) * (soldier.combatSpeed || 2.6) * SOLDIER_MOVE_SPEED_MULTIPLIER;
      soldier.aimAngle = angle;
      soldier.state = 'walking';
      soldier.selected = false;
      if (attackTarget) issueAttackOrder(soldier, attackTarget);
      else issueMoveOrder(soldier, target);
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
    const attackTarget = getAliveKaijus().sort((a, b) => (
      Math.hypot((a.x || 0) - target.x, (a.z || 0) - target.z)
      - Math.hypot((b.x || 0) - target.x, (b.z || 0) - target.z)
    ))[0] || null;
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
      soldier.vx = Math.cos(angle) * (soldier.combatSpeed || 2.6) * SOLDIER_MOVE_SPEED_MULTIPLIER;
      soldier.vz = Math.sin(angle) * (soldier.combatSpeed || 2.6) * SOLDIER_MOVE_SPEED_MULTIPLIER;
      soldier.aimAngle = angle;
      soldier.state = 'walking';
      soldier.selected = false;
      if (loadoutKey === 'engineer' || !attackTarget) issueMoveOrder(soldier, target);
      else issueAttackOrder(soldier, attackTarget);
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
    const speed = 3.2 * (tank.speedMultiplier || 1) * TANK_MOVE_SPEED_MULTIPLIER;
    tank.vx = Math.cos(angle) * speed;
    tank.vz = Math.sin(angle) * speed;
    tank.rotation = -angle;
    tank.selected = false;
    const attackTarget = getAliveKaijus().sort((a, b) => (
      Math.hypot((a.x || 0) - target.x, (a.z || 0) - target.z)
      - Math.hypot((b.x || 0) - target.x, (b.z || 0) - target.z)
    ))[0] || null;
    if (attackTarget) issueAttackOrder(tank, attackTarget);
    else issueMoveOrder(tank, target);
    entitiesRef.current.push(tank);
  };
  const spawnAPCFromBunker = (bunker, target) => {
    const tank = createTankReinforcement(
      `apc-deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      bunker,
      {
        variant: 'apc',
        scale: 1.12,
        speedMultiplier: APC_SPEED_MULTIPLIER,
        damageMultiplier: (economyRef.current.tankDamageMultiplier || 1) * APC_DAMAGE_MULTIPLIER,
        reloadMultiplier: (economyRef.current.tankReloadMultiplier || 1) * APC_RELOAD_MULTIPLIER
      }
    );
    const angle = getDeployAngle(bunker, target);
    const speed = 3.35 * (tank.speedMultiplier || 1) * TANK_MOVE_SPEED_MULTIPLIER;
    tank.vx = Math.cos(angle) * speed;
    tank.vz = Math.sin(angle) * speed;
    tank.rotation = -angle;
    tank.selected = false;
    const attackTarget = getAliveKaijus().sort((a, b) => (
      Math.hypot((a.x || 0) - target.x, (a.z || 0) - target.z)
      - Math.hypot((b.x || 0) - target.x, (b.z || 0) - target.z)
    ))[0] || null;
    if (attackTarget) issueAttackOrder(tank, attackTarget);
    else issueMoveOrder(tank, target);
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
    AudioManager.play('build_place');
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
  const activateFacilityInteraction = (facilityId) => {
    const facility = facilityId ? entityLookupRef.current.get(facilityId) : getSelectedProductionBuilding();
    const option = getFacilityInteractionOption(facility?.kind);
    const now = Date.now();
    if (!facility || facility.type !== 'facility' || facility.dead || facility.constructing || isBrokenStructure(facility) || !option) return false;
    if ((facility.abilityCooldownUntil || 0) > now) return false;
    if (!spendCommandCredits(option.cost)) return false;

    facility.abilityActiveUntil = now + option.durationMs;
    facility.abilityCooldownUntil = now + option.cooldownMs;
    facility.abilityPulseUntil = now + 900;

    if (facility.kind === 'powerplant') {
      addCredits(18);
    } else if (facility.kind === 'war_factory') {
      frameSnapshotRef.current.liveTanks.forEach((ally) => {
        if (!ally || ally.dead) return;
        const dist = Math.hypot((ally.x || 0) - facility.x, (ally.z || 0) - facility.z);
        if (dist > WAR_FACTORY_REFIT_RADIUS) return;
        ally.hp = Math.min(ally.maxHp || TANK_BASE_HP, (ally.hp || 0) + WAR_FACTORY_REFIT_REPAIR);
        if (ally.state === 'broken' && (ally.hp || 0) > (ally.maxHp || TANK_BASE_HP) * 0.34) ally.state = 'driving';
      });
    } else if (facility.kind === 'tech_lab') {
      const compressCooldown = (until) => {
        if (!until || until <= now) return until;
        return now + (until - now) * TECH_LAB_STRIKE_COOLDOWN_MULTIPLIER;
      };
      targetingRef.current.cooldownUntil = compressCooldown(targetingRef.current.cooldownUntil);
      Object.keys(targetingRef.current.supportCooldowns || {}).forEach((key) => {
        targetingRef.current.supportCooldowns[key] = compressCooldown(targetingRef.current.supportCooldowns[key]);
      });
      economyRef.current.techOverclockUntil = facility.abilityActiveUntil;
    } else if (facility.kind === 'radar_tower') {
      economyRef.current.radarScanUntil = facility.abilityActiveUntil;
      frameSnapshotRef.current.aliveKaijus.forEach((kaiju) => {
        kaiju.lastElementHitAt = now;
        kaiju.lastElementState = 'advantage';
      });
    }

    syncSelectedProductionBuildingMeta();
    AudioManager.play('target_confirm', { volume: 0.12, duration: 0.18 });
    queueDeployFeedback(true);
    return true;
  };
  const launchJetSupport = (sourceFacility = null) => {
    const targetKaiju = getAliveKaijus().sort((a, b) => {
      const aRatio = a.hp / a.maxHp;
      const bRatio = b.hp / b.maxHp;
      return aRatio - bRatio;
    })[0];
    if (!targetKaiju) return false;
    entitiesRef.current.push(
      sourceFacility
        ? createJetReinforcementFromFacility(`jet-deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, targetKaiju, sourceFacility)
        : createJetReinforcement(`jet-deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, targetKaiju)
    );
    AudioManager.play('jet_engine', { volume: 0.12, duration: 0.48 });
    return true;
  };
  const getSupportStrikeCooldownRemaining = (abilityKey = 'nuke') => {
    if (abilityKey === 'nuke') {
      return Math.max(0, targetingRef.current.cooldownUntil - Date.now());
    }
    return Math.max(0, (targetingRef.current.supportCooldowns?.[abilityKey] || 0) - Date.now());
  };
  const hasActiveSupportStrike = () => (
    entitiesRef.current.some((e) => (
      (((e.type === 'plane' || e.type === 'bomb') && e.isManual) || (e.type === 'support_fx' && e.isManual))
      && !e.dead
    ))
  );
  const canLaunchSupportStrike = (abilityKey = 'nuke') => {
    const option = getSupportStrikeOption(abilityKey);
    if (!option) return false;
    if (!hasPrerequisites(economyRef.current.buildings || {}, option.requires || [])) return false;
    if (targetingRef.current.isStrikeInProgress) return false;
    if (hasActiveSupportStrike()) return false;
    if (getSupportStrikeCooldownRemaining(abilityKey) > 0) return false;
    return true;
  };
  const canArmSupportStrike = (abilityKey = 'nuke') => {
    const option = getSupportStrikeOption(abilityKey);
    if (!option) return false;
    return canLaunchSupportStrike(abilityKey) && economyRef.current.credits >= option.cost;
  };
  const getManualStrikeCooldownRemaining = () => getSupportStrikeCooldownRemaining('nuke');
  const hasActiveManualStrike = () => hasActiveSupportStrike();
  const canLaunchManualStrike = () => canLaunchSupportStrike('nuke');
  const canArmManualStrike = () => canArmSupportStrike('nuke');
  const getFacilityStrikeDamageMultiplier = () => {
    let multiplier = 1;
    const now = Date.now();
    if ((economyRef.current.techOverclockUntil || 0) > now) multiplier *= 1.14;
    if ((economyRef.current.radarScanUntil || 0) > now) multiplier *= RADAR_SCAN_STRIKE_DAMAGE_MULTIPLIER;
    return multiplier;
  };
  const setSupportStrikeCooldown = (abilityKey) => {
    const option = getSupportStrikeOption(abilityKey);
    if (!option) return 0;
    const multiplier = economyRef.current.buildings?.radar_tower
      ? (abilityKey === 'nuke' ? RADAR_NUKE_COOLDOWN_MULTIPLIER : SUPPORT_STRIKE_RADAR_COOLDOWN_MULTIPLIER)
      : 1;
    const cooldownMs = Math.round(option.cooldownMs * multiplier);
    if (abilityKey === 'nuke') {
      targetingRef.current.cooldownUntil = Date.now() + cooldownMs;
    } else {
      targetingRef.current.supportCooldowns[abilityKey] = Date.now() + cooldownMs;
    }
    return cooldownMs;
  };
  const clearPendingStrikeArm = () => {
    targetingRef.current.manualStrikeArmed = false;
    targetingRef.current.armedSupportKey = null;
    window._falloutManualStrikeArmed = false;
    window._falloutArmedSupportKey = null;
    window._falloutSupportPreview = null;
  };
  const setPendingStrikeArm = (abilityKey = 'nuke') => {
    targetingRef.current.manualStrikeArmed = abilityKey === 'nuke';
    targetingRef.current.armedSupportKey = abilityKey;
    targetingRef.current.pendingDeploy = null;
    targetingRef.current.pendingBuild = null;
    window._falloutManualStrikeArmed = abilityKey === 'nuke';
    window._falloutArmedSupportKey = abilityKey;
    window._falloutSupportPreview = getSupportStrikePreview(abilityKey);
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
        element: variantConfig.element,
        weakAgainst: variantConfig.weakAgainst,
        resistAgainst: variantConfig.resistAgainst,
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
        element: variantConfig.element,
        weakAgainst: variantConfig.weakAgainst,
        resistAgainst: variantConfig.resistAgainst,
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
    targetingRef.current.armedSupportKey = null;
    targetingRef.current.supportCooldowns = createDefaultSupportCooldownMap();
    targetingRef.current.pendingDeploy = null;
    targetingRef.current.pendingBuild = null;
    window._falloutConfirmedTarget = null;
    window._falloutStrikeCooldownRemaining = 0;
    window._falloutManualStrikeInFlight = false;
    window._falloutManualStrikeArmed = false;
    window._falloutArmedSupportKey = null;
    window._falloutSupportPreview = null;
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
    window._falloutSelectedProductionBuilding = null;
    window._falloutGroupCommandTarget = null;
    window._falloutUnitCommandMarkers = [];
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
    if (!spendCommandCredits(getSupportStrikeOption('nuke').cost)) {
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

  const applyOrbitalLancePulse = (x, z, intensity = 1) => {
    const outerRadius = 190;
    const midRadius = 120;
    const coreRadius = 74;
    const supportDamageMultiplier = getFacilityStrikeDamageMultiplier();

    entitiesRef.current.forEach((other) => {
      if (!other || other.dead || other.type === 'support_fx' || other.type === 'scorch' || other.type === 'plane' || other.type === 'bomb' || other.type === 'mushroom') return;
      const dist = Math.hypot((other.x || 0) - x, (other.z || 0) - z);
      if (dist > outerRadius) return;

      if (other.type === 'kaiju') {
        const damage = (dist < coreRadius ? 240 * intensity : dist < midRadius ? 148 * intensity : 72 * intensity) * supportDamageMultiplier;
        applyKaijuElementalDamage(other, damage, 'orbital_lance');
        other.staggered = true;
        other.staggerTimer = Math.max(other.staggerTimer || 0, 70 + damage * 0.18);
        if (other.hp <= 0) markKaijuDefeated(other);
      } else if (other.type === 'house') {
        other.state = dist < coreRadius ? 'ruined' : 'broken';
      } else if (other.type === 'tree' || other.type === 'car') {
        other.state = 'broken';
      }
    });

    pushImpactPuffEntity(entitiesRef.current, x, z, getTerrainHeight(x, z) + 10);
    if (Math.random() < 0.7) {
      pushImpactPuffEntity(entitiesRef.current, x + (Math.random() - 0.5) * 36, z + (Math.random() - 0.5) * 36, getTerrainHeight(x, z) + 8);
    }
  };

  const spawnFirestormPatch = (x, z, radius = 56) => {
    const patch = clampStrikeTarget({ x, z });
    const supportDamageMultiplier = getFacilityStrikeDamageMultiplier();
    pushScorchEntity(entitiesRef.current, patch.x, patch.z, radius, {
      kind: 'firestorm_patch',
      temporary: true,
      ttl: FIRESTORM_PATCH_TTL + Math.random() * 2.2,
      burnLife: FIRESTORM_PATCH_TTL,
      coreLife: FIRESTORM_PATCH_TTL * 0.7,
      smokeLife: FIRESTORM_PATCH_TTL * 0.88,
      baseColor: '#160c07',
      ringColor: '#3f1f11',
      coreColor: '#ff6b1a',
      heatColor: '#ff9b2f',
      baseOpacity: 0.82,
      coreOpacity: 0.52,
      heatOpacity: 0.24,
      flameCount: 4,
      smokeCount: 3,
      firePulseSpeed: 5.8 + Math.random() * 1.2,
      smokeDrift: 4.2 + Math.random() * 2.4,
      burnRadius: radius * 2.3,
      damagePerSecond: 42 * supportDamageMultiplier,
      damageRadius: radius * 1.35,
      affectsFlying: false,
      element: 'fire'
    });
    pushImpactPuffEntity(entitiesRef.current, patch.x, patch.z, getTerrainHeight(patch.x, patch.z) + 5);
    entitiesRef.current.forEach((other) => {
      if (!other || other.dead || other.type !== 'kaiju' || isFlyingKaiju(other)) return;
      const dist = Math.hypot((other.x || 0) - patch.x, (other.z || 0) - patch.z);
      if (dist > radius * 1.28) return;
      const damage = Math.max(18, (radius * 1.28 - dist) * 0.95) * supportDamageMultiplier;
      applyKaijuElementalDamage(other, damage, 'firestorm');
      other.staggered = true;
      other.staggerTimer = Math.max(other.staggerTimer || 0, 42);
      if (other.hp <= 0) markKaijuDefeated(other);
    });
  };

  const getFocusedKaijuStrikeTarget = (target, maxLockRadius = 160) => {
    if (!target) return null;
    const clampedTarget = clampStrikeTarget(target);
    let best = null;
    let bestDist = Infinity;
    getAliveKaijus().forEach((kaiju) => {
      const dist = Math.hypot((kaiju.x || 0) - clampedTarget.x, (kaiju.z || 0) - clampedTarget.z);
      if (dist < bestDist) {
        bestDist = dist;
        best = kaiju;
      }
    });
    if (!best) return null;
    if (bestDist > maxLockRadius) return null;
    return best;
  };

  const beginSupportStrikeCast = (abilityKey, target) => {
    const clampedTarget = clampStrikeTarget(target);
    const option = getSupportStrikeOption(abilityKey);
    clearPendingDeploy();
    clearPendingBuild();
    if (!option || !canLaunchSupportStrike(abilityKey)) {
      clearPendingStrikeArm();
      AudioManager.play('target_blocked');
      return null;
    }
    if (!spendCommandCredits(option.cost)) {
      clearPendingStrikeArm();
      AudioManager.play('target_blocked');
      return null;
    }
    clearPendingStrikeArm();
    targetingRef.current.isStrikeInProgress = true;
    setConfirmedTarget(clampedTarget);
    window._nukeInteractionTriggered = true;
    window._falloutTargetConfirmedFlash = true;
    window._falloutManualStrikeInFlight = true;
    window._falloutStrikeCooldownRemaining = 0;
    if (cutsceneTimer.current > 0) cutsceneTimer.current = 0.1;
    AudioManager.play('target_confirm');
    setTimeout(() => { window._falloutTargetConfirmedFlash = false; }, 500);
    return { clampedTarget, option };
  };

  const launchOrbitalLance = (target) => {
    const cast = beginSupportStrikeCast('orbital_lance', target);
    if (!cast) return false;
    const { clampedTarget } = cast;
    const effect = {
      id: `support-orbital-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'support_fx',
      kind: 'orbital_lance',
      x: clampedTarget.x,
      y: getTerrainHeight(clampedTarget.x, clampedTarget.z),
      z: clampedTarget.z,
      age: 0,
      duration: ORBITAL_LANCE_DURATION,
      pulseSchedule: [0.04, 0.42, 0.92],
      pulseIndex: 0,
      isManual: true,
      dead: false
    };
    entitiesRef.current.push(effect);
    applyOrbitalLancePulse(clampedTarget.x, clampedTarget.z, 1.05);
    pushScorchEntity(entitiesRef.current, clampedTarget.x, clampedTarget.z, 48, {
      kind: 'orbital_lance_mark',
      temporary: true,
      ttl: 3.2,
      smokeCount: 2,
      flameCount: 0,
      coreOpacity: 0.28,
      heatOpacity: 0.18,
      baseColor: '#050b14',
      ringColor: '#123048',
      coreColor: '#38bdf8',
      heatColor: '#67e8f9'
    });
    const cooldownMs = setSupportStrikeCooldown('orbital_lance');
    window._falloutStrikeCooldownRemaining = cooldownMs;
    AudioManager.play('missile_launch', { volume: 0.14, duration: 0.18 });
    const _olX = clampedTarget.x, _olZ = clampedTarget.z;
    setTimeout(() => {
      AudioManager.play('orbital_lance');
      window.dispatchEvent(new CustomEvent('fallout-explosion', {
        detail: { x: _olX, z: _olZ, intensity: 2.1, type: 'orbital_lance' }
      }));
      if (typeof window._falloutAddCrater === 'function') {
        window._falloutAddCrater({ type: 'orbital_lance', x: _olX, z: _olZ, radius: 70, depth: 40 });
      }
    }, 1350);
    return true;
  };

  const launchFirestormStrike = (target) => {
    const cast = beginSupportStrikeCast('firestorm', target);
    if (!cast) return false;
    const { clampedTarget } = cast;
    const nearestKaiju = getAliveKaijus().sort((a, b) => (
      Math.hypot(a.x - clampedTarget.x, a.z - clampedTarget.z) - Math.hypot(b.x - clampedTarget.x, b.z - clampedTarget.z)
    ))[0];
    const heading = nearestKaiju
      ? Math.atan2(nearestKaiju.z - clampedTarget.z, nearestKaiju.x - clampedTarget.x)
      : Math.random() * Math.PI * 2;
    const lineAngle = heading + Math.PI / 2;
    const offsets = [-160, -80, 0, 80, 160];

    entitiesRef.current.push({
      id: `support-firestorm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'support_fx',
      kind: 'firestorm',
      x: clampedTarget.x,
      y: getTerrainHeight(clampedTarget.x, clampedTarget.z),
      z: clampedTarget.z,
      age: 0,
      duration: FIRESTORM_EFFECT_DURATION,
      isManual: true,
      dead: false
    });

    offsets.forEach((offset, index) => {
      const patchX = clampedTarget.x + Math.cos(lineAngle) * offset;
      const patchZ = clampedTarget.z + Math.sin(lineAngle) * offset;
      spawnFirestormPatch(patchX, patchZ, 56 + (index % 2) * 8);
    });

    const cooldownMs = setSupportStrikeCooldown('firestorm');
    window._falloutStrikeCooldownRemaining = cooldownMs;
    AudioManager.play('missile_launch', { volume: 0.14, duration: 0.18 });
    const _fsX = clampedTarget.x, _fsZ = clampedTarget.z;
    setTimeout(() => {
      AudioManager.play('firestorm');
      window.dispatchEvent(new CustomEvent('fallout-explosion', {
        detail: { x: _fsX, z: _fsZ, intensity: 1.9, type: 'firestorm' }
      }));
    }, 900);
    return true;
  };

  const launchKineticSpear = (target) => {
    const cast = beginSupportStrikeCast('kinetic_spear', target);
    if (!cast) return false;
    const supportDamageMultiplier = getFacilityStrikeDamageMultiplier();
    const focusedKaiju = getFocusedKaijuStrikeTarget(cast.clampedTarget, 180);
    const impactX = focusedKaiju ? focusedKaiju.x : cast.clampedTarget.x;
    const impactZ = focusedKaiju ? focusedKaiju.z : cast.clampedTarget.z;
    const impactY = getTerrainHeight(impactX, impactZ);

    entitiesRef.current.push({
      id: `support-spear-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'support_fx',
      kind: 'kinetic_spear',
      x: impactX,
      y: impactY,
      z: impactZ,
      age: 0,
      duration: KINETIC_SPEAR_DURATION,
      isManual: true,
      dead: false
    });

    entitiesRef.current.forEach((other) => {
      if (!other || other.dead || other.type === 'support_fx' || other.type === 'plane' || other.type === 'bomb' || other.type === 'mushroom') return;
      const dist = Math.hypot((other.x || 0) - impactX, (other.z || 0) - impactZ);
      if (other.type === 'kaiju') {
        const isPrimary = focusedKaiju && other.id === focusedKaiju.id;
        if (isPrimary) {
          applyKaijuElementalDamage(other, 560 * supportDamageMultiplier, 'kinetic_spear');
          other.staggered = true;
          other.staggerTimer = Math.max(other.staggerTimer || 0, 150);
          other.specialState = 'impaled';
          other.specialTimer = Math.max(other.specialTimer || 0, 1.1);
        } else if (dist <= 88) {
          applyKaijuElementalDamage(other, Math.max(70, 180 - dist * 1.1) * supportDamageMultiplier, 'kinetic_spear');
          other.staggered = true;
          other.staggerTimer = Math.max(other.staggerTimer || 0, 78);
        }
        if (other.hp <= 0) markKaijuDefeated(other);
      } else if ((other.type === 'house' || other.type === 'facility' || other.type === 'bunker') && dist <= 42) {
        if (other.type === 'house') other.state = 'ruined';
      } else if ((other.type === 'tree' || other.type === 'car') && dist <= 54) {
        other.state = 'broken';
      }
    });

    pushImpactPuffEntity(entitiesRef.current, impactX, impactZ, impactY + 12);
    pushImpactPuffEntity(entitiesRef.current, impactX + 12, impactZ - 8, impactY + 8);
    pushScorchEntity(entitiesRef.current, impactX, impactZ, 36, {
      kind: 'kinetic_spear_mark',
      temporary: true,
      ttl: 4.8,
      smokeCount: 2,
      flameCount: 1,
      coreOpacity: 0.34,
      heatOpacity: 0.2,
      baseColor: '#06080d',
      ringColor: '#2f3f56',
      coreColor: '#e2e8f0',
      heatColor: '#7dd3fc',
      burnRadius: 64,
      damagePerSecond: 16,
      damageRadius: 54,
      affectsFlying: false,
      element: 'ion'
    });

    const cooldownMs = setSupportStrikeCooldown('kinetic_spear');
    window._falloutStrikeCooldownRemaining = cooldownMs;
    AudioManager.play('missile_launch', { volume: 0.10, duration: 0.14 });
    setTimeout(() => {
      AudioManager.play('kinetic_spear');
      window.dispatchEvent(new CustomEvent('fallout-explosion', {
        detail: { x: impactX, z: impactZ, intensity: 2.6, type: 'kinetic_spear' }
      }));
      if (typeof window._falloutAddCrater === 'function') {
        window._falloutAddCrater({ type: 'kinetic_spear', x: impactX, z: impactZ, radius: 52, depth: 28 });
      }
    }, 2470);
    return true;
  };

  const launchWarthogRun = (target) => {
    const cast = beginSupportStrikeCast('warthog_run', target);
    if (!cast) return false;
    const { clampedTarget } = cast;
    const focusedKaiju = getFocusedKaijuStrikeTarget(clampedTarget, 360);
    const targetX = focusedKaiju ? focusedKaiju.x : clampedTarget.x;
    const targetZ = focusedKaiju ? focusedKaiju.z : clampedTarget.z;

    // Spawn the A-10 from a random edge, flying perpendicular across the target
    const fromLeft = Math.random() > 0.5;
    const lateralOffset = (Math.random() - 0.5) * 25; // tight offset so bullets actually hit the target
    const warthog = {
      id: `warthog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'warthog',
      x: fromLeft ? -WORLD_WIDTH / 2 - 440 : WORLD_WIDTH / 2 + 440,
      y: 130 + Math.random() * 20,  // low attack pass so you can clearly see the plane
      z: targetZ + lateralOffset,
      vx: fromLeft ? 8 : -8,        // slower so the player can appreciate the flyby
      vz: 0,
      targetX,
      targetZ,
      targetKaijuId: focusedKaiju?.id || null,
      fireStarted: false,
      fireDone: false,
      bulletsFired: 0,
      bulletMax: 30,                 // ~3+ seconds of GAU-8 fire
      fireTimer: 0,
      fireInterval: 0.09,            // 30 rounds over ~2.7 s
      flightAge: 0,
      dead: false
    };

    entitiesRef.current.push(warthog);
    const cooldownMs = setSupportStrikeCooldown('warthog_run');
    window._falloutStrikeCooldownRemaining = cooldownMs;
    AudioManager.play('plane_engine', { volume: 0.18, duration: 0.9 });
    AudioManager.play('plane_flyby', { volume: 0.10, duration: 1.2 });
    return true;
  };

  const launchSupportStrike = (abilityKey, target) => {
    if (!target) return false;
    if (abilityKey === 'nuke') return launchManualStrike(target, { idPrefix: 'plane-manual', speed: 7 });
    if (abilityKey === 'orbital_lance') return launchOrbitalLance(target);
    if (abilityKey === 'firestorm') return launchFirestormStrike(target);
    if (abilityKey === 'kinetic_spear') return launchKineticSpear(target);
    if (abilityKey === 'warthog_run') return launchWarthogRun(target);
    return false;
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
      if (e.target.closest('.fallout-ui-area')) return;
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
      const sourceBuildingId = event?.detail?.sourceBuildingId || null;
      const option = DEPLOY_OPTIONS[unitType];
      if (!option) return;
      if (!isDeployUnlocked(unitType)) {
        queueDeployFeedback(false);
        clearPendingDeploy();
        return;
      }
      const productionSource = getProductionSourceForUnit(unitType, sourceBuildingId);
      if (isQueuedDeployUnit(unitType) && !productionSource) {
        queueDeployFeedback(false);
        clearPendingDeploy();
        return;
      }
      if (isQueuedDeployUnit(unitType)) {
        if (!productionSource || economyRef.current.credits < option.cost) {
          queueDeployFeedback(false);
          clearPendingDeploy();
          return;
        }
        if (!spendCommandCredits(option.cost) || !enqueueFacilityProduction(productionSource, unitType)) {
          queueDeployFeedback(false);
          return;
        }
        queueDeployFeedback(true);
        clearPendingDeploy();
        return;
      }
      if ((!getBestDeployBunker() && !productionSource) || !getAliveKaijus().length || economyRef.current.credits < option.cost) {
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
      const sourceBuildingId = event?.detail?.sourceBuildingId || null;
      const option = DEPLOY_OPTIONS[unitType];
      if (!option) return;
      if (!isDeployUnlocked(unitType)) {
        queueDeployFeedback(false);
        clearPendingDeploy();
        return;
      }

      const bunker = getBestDeployBunker();
      const productionSource = getProductionSourceForUnit(unitType, sourceBuildingId) || bunker;
      if (!productionSource || !getAliveKaijus().length) {
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
        else spawnSquadFromBunker(productionSource, target);
      } else if (unitType === 'gunner_team') {
        if (!target) success = false;
        else spawnSpecialistTeamFromBunker(productionSource, target, { count: 3, loadoutKey: 'gunner', spreadStep: 0.4 });
      } else if (unitType === 'sniper_team') {
        if (!target) success = false;
        else spawnSpecialistTeamFromBunker(productionSource, target, { count: 2, loadoutKey: 'marksman', spreadStep: 0.5 });
      } else if (unitType === 'rpg_team') {
        if (!target) success = false;
        else spawnSpecialistTeamFromBunker(productionSource, target, { count: 2, loadoutKey: 'rpg', spreadStep: 0.56 });
      } else if (unitType === 'missile_team') {
        if (!target) success = false;
        else spawnSpecialistTeamFromBunker(productionSource, target, { count: 2, loadoutKey: 'missile', spreadStep: 0.64 });
      } else if (unitType === 'engineer_team') {
        if (!target) success = false;
        else spawnSpecialistTeamFromBunker(productionSource, target, { count: 2, loadoutKey: 'engineer', spreadStep: 0.42 });
      } else if (unitType === 'barricade') {
        if (!target) success = false;
        else spawnBarricade(productionSource, target);
      } else if (unitType === 'tank') {
        if (!target) success = false;
        else spawnTankFromBunker(productionSource, target);
      } else if (unitType === 'apc') {
        if (!target) success = false;
        else spawnAPCFromBunker(productionSource, target);
      } else if (unitType === 'jet') {
        success = launchJetSupport(productionSource?.type === 'facility' ? productionSource : null);
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
      if (nextPending) { setPendingBuild(nextPending); AudioManager.play('build_select'); }
      else clearPendingBuild();
    };
    const handleUpgradePurchase = (event) => {
      const upgradeKey = event?.detail?.upgradeType;
      if (!upgradeKey) return;
      const purchased = purchaseUpgrade(upgradeKey);
      if (!purchased) queueDeployFeedback(false);
    };
    const toggleSupportArm = (abilityKey = 'nuke') => {
      const activeKey = targetingRef.current.armedSupportKey || (targetingRef.current.manualStrikeArmed ? 'nuke' : null);
      if (activeKey === abilityKey) {
        clearPendingStrikeArm();
        return;
      }
      if (!canArmSupportStrike(abilityKey)) {
        queueDeployFeedback(false);
        return;
      }
      setPendingStrikeArm(abilityKey);
      queueDeployFeedback(true);
    };
    const handleSupportArmSelection = (event) => {
      toggleSupportArm(event?.detail?.abilityKey || 'nuke');
    };
    const handleNukeArmSelection = () => {
      toggleSupportArm('nuke');
    };
    const handleControlGroupSelection = (event) => {
      const groupKey = event?.detail?.groupKey || 'all';
      const units = getUnitsForControlGroup(groupKey);
      if (units.length) {
        setSelectedUnits(units, false);
        queueDeployFeedback(true);
      } else {
        clearUnitSelection();
        queueDeployFeedback(false);
      }
    };
    const handleClearProductionSelection = () => {
      clearSelectedProductionBuilding();
    };
    const handleFacilityInteraction = (event) => {
      const facilityId = event?.detail?.facilityId || selectedProductionBuildingIdRef.current || null;
      if (!activateFacilityInteraction(facilityId)) {
        queueDeployFeedback(false);
      }
    };

    window.addEventListener('fallout-select-deploy', handleDeploySelection);
    window.addEventListener('fallout-deploy-unit', handleDeployRequest);
    window.addEventListener('fallout-select-building', handleBuildingSelection);
    window.addEventListener('fallout-purchase-building', handleBuildingPurchase);
    window.addEventListener('fallout-purchase-upgrade', handleUpgradePurchase);
    window.addEventListener('fallout-arm-nuke', handleNukeArmSelection);
    window.addEventListener('fallout-arm-support', handleSupportArmSelection);
    window.addEventListener('fallout-select-control-group', handleControlGroupSelection);
    window.addEventListener('fallout-clear-production-building', handleClearProductionSelection);
    window.addEventListener('fallout-facility-action', handleFacilityInteraction);

    // Pilot HUD: player aimed and clicked PICKLE — map screen coords to world and fire
    const handlePilotRelease = (event) => {
      const { clientX, clientY } = event.detail || {};
      if (clientX == null || clientY == null) return;
      const target = getPointerStrikeTargetFromClient(clientX, clientY);
      if (target) deployManualStrike(target);
    };
    window.addEventListener('fallout-pilot-release', handlePilotRelease);

    return () => {
      window.removeEventListener('fallout-select-deploy', handleDeploySelection);
      window.removeEventListener('fallout-deploy-unit', handleDeployRequest);
      window.removeEventListener('fallout-select-building', handleBuildingSelection);
      window.removeEventListener('fallout-purchase-building', handleBuildingPurchase);
      window.removeEventListener('fallout-purchase-upgrade', handleUpgradePurchase);
      window.removeEventListener('fallout-arm-nuke', handleNukeArmSelection);
      window.removeEventListener('fallout-arm-support', handleSupportArmSelection);
      window.removeEventListener('fallout-select-control-group', handleControlGroupSelection);
      window.removeEventListener('fallout-clear-production-building', handleClearProductionSelection);
      window.removeEventListener('fallout-facility-action', handleFacilityInteraction);
      window.removeEventListener('fallout-pilot-release', handlePilotRelease);
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
    const supportDamageMultiplier = getFacilityStrikeDamageMultiplier();

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
    // Crater — real terrain deformation at the blast site
    if (typeof window._falloutAddCrater === 'function') {
      window._falloutAddCrater({
        type: 'nuke',
        x: blastX, z: blastZ,
        radius: bomb.isManual ? 285 : 205,
        depth:  bomb.isManual ? 60  : 44
      });
    }

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
        const damage = Math.max(0, damageRadius - dist) * damageMultiplier * supportDamageMultiplier;
        if (other.type === 'kaiju' && bomb.isManual) {
          applyKaijuElementalDamage(other, damage, 'nuke');
        } else {
          other.hp -= damage;
        }
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
          if (other.type === 'facility') AudioManager.play('build_destroy');
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
            const blastDamage = (dist < severeStructureRadius ? 260 : 165) * supportDamageMultiplier;
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

    // Update global shader time uniform so all alive-shader animations run
    globalShaderUniforms.time.value = state.clock.elapsedTime;

    const frameSnapshot = rebuildFrameSnapshot();
    
    // === GLOBAL STRIKE PROGRESSION STATUS ===
    // Check if the current manual strike has cleared
    const armedSupportKey = targetingRef.current.armedSupportKey || (targetingRef.current.manualStrikeArmed ? 'nuke' : null);
    const activeManualStrike = hasActiveSupportStrike();
    const cooldownRemaining = armedSupportKey ? getSupportStrikeCooldownRemaining(armedSupportKey) : 0;
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
    const isStrikeMode = !!armedSupportKey;
    const placementTarget = window._falloutMouseTarget || window._falloutBuildFallbackTarget || null;
    const buildPlacement = isBuildMode && placementTarget
      ? validateBuildingPlacement(placementTarget, { snap: true })
      : { ok: false };
    const deployUnlocks = getDeployUnlocks();
    window._falloutTargetProgress = !isDeployMode && !isBuildMode && isStrikeMode && hasPointerTarget ? 1 : 0;
    window._falloutManualStrikeInFlight = targetingRef.current.isStrikeInProgress || activeManualStrike;
    window._falloutManualStrikeArmed = armedSupportKey === 'nuke';
    window._falloutArmedSupportKey = armedSupportKey;
    window._falloutSupportPreview = armedSupportKey ? getSupportStrikePreview(armedSupportKey) : null;
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
    // Keep the last known fallback position when in build OR strike-arm mode so the targeting ring
    // doesn't disappear when the mouse is temporarily over the HUD overlay buttons.
    window._falloutBuildFallbackTarget = isBuildMode
      ? (buildPlacement.target || placementTarget)
      : isStrikeMode
      ? (placementTarget || window._falloutBuildFallbackTarget)
      : null;
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
      // Expose bomb telemetry for BombCamHUD overlay
      window._falloutBombCamAlt = activeBombCamBomb.y;
      window._falloutBombCamVelocity = Math.hypot(activeBombCamBomb.vx || 0, activeBombCamBomb.vy || 0, activeBombCamBomb.vz || 0);
      window._falloutBombCamTargetX = bombTargetX;
      window._falloutBombCamTargetZ = bombTargetZ;
      window._falloutBombCamTargetAlt = targetTerrain;
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

        if (window._falloutManualStrikeArmed) {
          // ── NUKE TARGETING: lock to straight-down bird's-eye view ──
          // WASD panning still works (moveOffset updated above).
          // Camera snaps overhead, looking directly down at the target area.
          const birdEyeY = 1100;
          const lerpSpeed = 0.07;
          camera.position.x += (moveOffset.current.x - camera.position.x) * lerpSpeed;
          camera.position.z += (moveOffset.current.z - camera.position.z) * lerpSpeed;
          camera.position.y += (birdEyeY - camera.position.y) * lerpSpeed;
          camera.lookAt(moveOffset.current.x, 0, moveOffset.current.z);
        } else {
          // Orbital camera position using spherical coordinates
          const pitch = cameraRotation.current.pitch;
          const radius = 1200 / zoomLevel.current;
          
          camera.position.x = moveOffset.current.x + Math.sin(yaw) * Math.cos(pitch) * radius;
          camera.position.y = Math.sin(pitch) * radius;
          camera.position.z = moveOffset.current.z + Math.cos(yaw) * Math.cos(pitch) * radius;
          
          camera.lookAt(moveOffset.current.x, 0, moveOffset.current.z);
        }
        
        // Keep originalCamPos synced for shockwave shakes
        originalCamPos.current.copy(camera.position);
     }

    // === GARBAGE COLLECTION: Remove dead ephemeral entities every 120 frames ===
    gcCounter.current++;
    if (gcCounter.current >= 120) {
      gcCounter.current = 0;
      const ephemeralTypes = new Set(['bullet', 'shell', 'muzzle_flash', 'missile', 'missile_impact', 'impact_puff', 'corpse', 'mushroom', 'kaiju_attack', 'firebreath', 'support_fx']);
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
         if (typeof window !== 'undefined') {
           window.dispatchEvent(new CustomEvent('fallout-level-environment-shift', {
             detail: { level: waveRef.current.nextLevel }
           }));
         }
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
         const selectedUnits = getSelectedUnits();
         const supportCooldowns = Object.fromEntries(
            Object.keys(SUPPORT_STRIKE_OPTIONS).map((key) => [key, getSupportStrikeCooldownRemaining(key)])
         );
         const supportCanArm = Object.fromEntries(
           Object.keys(SUPPORT_STRIKE_OPTIONS).map((key) => [key, canArmSupportStrike(key)])
         );
         window._falloutGameStats = {
           bunkers: bunkers.map(b => ({ hp: b.hp, maxHp: b.maxHp, dead: b.dead || isBrokenStructure(b) })),
           tanks: frameSnapshot.liveTanks.filter(e => e.state !== 'broken').length,
           soldiers: frameSnapshot.liveSoldiers.length,
           jets: frameSnapshot.liveJets.length,
           credits: Math.floor(economyRef.current.credits),
           incomePerSecond,
           nukeCost: MANUAL_STRIKE_COST,
           nukeArmed: armedSupportKey === 'nuke',
           nukeCanArm: canArmSupportStrike('nuke'),
           supportOptions: SUPPORT_STRIKE_OPTIONS,
           armedSupportKey,
           selection: {
             count: selectedUnits.length,
             squads: selectedUnits.filter((unit) => unit.type === 'soldier' && unit.weaponType !== 'engineer').length,
             engineers: selectedUnits.filter((unit) => unit.type === 'soldier' && unit.weaponType === 'engineer').length,
             armor: selectedUnits.filter((unit) => unit.type === 'tank').length
           },
           selectedProductionBuilding: window._falloutSelectedProductionBuilding || null,
           supportCooldowns,
           supportCanArm,
           deployCosts: DEPLOY_OPTIONS,
          deployUnlocks: getDeployUnlocks(),
          buildOptions: BUILD_OPTIONS,
          buildState: getLiveFacilityBuildState(),
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
             environmentLabel: environmentVariant?.label || 'Frontier',
             totalLevels: waveRef.current.totalLevels,
             intermission: waveRef.current.transitioning,
             nextWaveSeconds: waveRef.current.transitioning
               ? Math.max(0, Math.ceil(waveRef.current.nextWaveAt - state.clock.elapsedTime))
               : 0,
             remainingKaijus: aliveKaijus.length
           },
            kaijus: kaijus.map(k => ({
              displayName: getKaijuDisplayName(k.variant),
              hp: Math.max(0, k.hp),
              maxHp: k.maxHp,
              dead: isKaijuDefeated(k),
              state: isKaijuDefeated(k) ? (k.dead || k.state === 'dead' ? 'dead' : 'dying') : (k.state || 'alive'),
              variant: k.variant,
              level: k.level,
              element: getKaijuElementalProfile(k).element,
              weakAgainst: getKaijuElementalProfile(k).weakAgainst,
              resistAgainst: getKaijuElementalProfile(k).resistAgainst,
              lastElementState: k.lastElementState || 'neutral',
              lastElementHitAt: k.lastElementHitAt || 0
            }))
          };
        }
     }

      entitiesRef.current.forEach((scorch) => {
       if (!scorch || scorch.dead || scorch.type !== 'scorch' || !scorch.damagePerSecond || !scorch.damageRadius) return;
       scorch.nextDamageTick = (scorch.nextDamageTick ?? 0) - delta;
       if (scorch.nextDamageTick > 0) return;
       const tickWindow = 0.22;
       scorch.nextDamageTick = tickWindow;
       entitiesRef.current.forEach((other) => {
         if (!other || other.dead || other.type !== 'kaiju') return;
         if (!scorch.affectsFlying && isFlyingKaiju(other)) return;
         const dist = Math.hypot((other.x || 0) - scorch.x, (other.z || 0) - scorch.z);
         if (dist > scorch.damageRadius) return;
         const damageFalloff = Math.max(0.22, 1 - dist / scorch.damageRadius);
         const appliedDamage = scorch.damagePerSecond * tickWindow * damageFalloff;
         const strikeKey = scorch.element === 'fire' ? 'firestorm' : scorch.element === 'radiation' ? 'nuke' : null;
         if (strikeKey) applyKaijuElementalDamage(other, appliedDamage, strikeKey);
         else other.hp -= appliedDamage;
         other.staggered = true;
         other.staggerTimer = Math.max(other.staggerTimer || 0, 18);
         if (other.hp <= 0) markKaijuDefeated(other);
       });
     });

      entitiesRef.current.forEach(p => {
       if (p.dead || p.type === 'tree' || p.type === 'house' || p.type === 'scorch') return;
       
       if (p.type === 'support_fx') {
         p.age = (p.age || 0) + delta;
         if (p.kind === 'orbital_lance' && Array.isArray(p.pulseSchedule)) {
           while (p.pulseIndex < p.pulseSchedule.length && p.age >= p.pulseSchedule[p.pulseIndex]) {
             applyOrbitalLancePulse(p.x, p.z, p.pulseIndex === 0 ? 1 : 0.72);
             p.pulseIndex += 1;
           }
         }
         if (p.age >= (p.duration || 0)) {
           p.dead = true;
         }
         return;
       }

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
        const now = Date.now();
        const abilityActive = (p.abilityActiveUntil || 0) > now;
        p.y = getTerrainHeight(p.x, p.z);
        if (p.hp <= 0) {
          if (p.constructing && economyRef.current.buildQueue?.[p.kind]) {
            economyRef.current.buildQueue[p.kind] = false;
          }
          markStructureBroken(p);
          AudioManager.play('build_destroy');
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
            AudioManager.play('build_complete');
          } else {
            return;
          }
        }
        if (abilityActive && p.kind === 'powerplant') {
          addCredits(POWERPLANT_OVERDRIVE_INCOME_PER_SECOND * delta);
        }
      if (p.kind === 'field_hospital') {
          const healDelta = delta * (abilityActive ? HOSPITAL_TRIAGE_MULTIPLIER : 1);
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
        p.productionQueue = Array.isArray(p.productionQueue) ? p.productionQueue : [];
        if ((BUILDING_DEPLOY_OPTIONS[p.kind] || []).length > 0) {
          if (!p.trainingUnitType && p.productionQueue.length > 0) {
            p.trainingUnitType = p.productionQueue[0].unitType;
            p.trainingRemaining = p.productionQueue[0].duration;
            p.trainingProgress = 0;
          }
          if (p.trainingUnitType) {
            const activeJob = p.productionQueue[0];
            const duration = activeJob?.duration || DEPLOY_TRAINING_DURATIONS[p.trainingUnitType] || 5.5;
            const trainingBoost = p.kind === 'powerplant' && abilityActive
              ? POWERPLANT_OVERDRIVE_TRAINING_MULTIPLIER
              : p.kind === 'war_factory' && abilityActive
              ? WAR_FACTORY_TRAINING_MULTIPLIER
              : p.kind === 'tech_lab' && abilityActive
              ? TECH_LAB_TRAINING_MULTIPLIER
              : 1;
            p.trainingRemaining = Math.max(0, (p.trainingRemaining || duration) - delta * trainingBoost);
            p.trainingProgress = THREE.MathUtils.clamp(1 - (p.trainingRemaining / duration), 0, 1);
            if (p.trainingRemaining <= 0) {
              const trainedUnitType = activeJob?.unitType || p.trainingUnitType;
              const autoTarget = getFacilityDeployTarget(p);
              let success = true;
              if (trainedUnitType === 'squad') {
                spawnSquadFromBunker(p, autoTarget);
              } else if (trainedUnitType === 'gunner_team') {
                spawnSpecialistTeamFromBunker(p, autoTarget, { count: 3, loadoutKey: 'gunner', spreadStep: 0.4 });
              } else if (trainedUnitType === 'sniper_team') {
                spawnSpecialistTeamFromBunker(p, autoTarget, { count: 2, loadoutKey: 'marksman', spreadStep: 0.5 });
              } else if (trainedUnitType === 'rpg_team') {
                spawnSpecialistTeamFromBunker(p, autoTarget, { count: 2, loadoutKey: 'rpg', spreadStep: 0.56 });
              } else if (trainedUnitType === 'missile_team') {
                spawnSpecialistTeamFromBunker(p, autoTarget, { count: 2, loadoutKey: 'missile', spreadStep: 0.64 });
              } else if (trainedUnitType === 'engineer_team') {
                spawnSpecialistTeamFromBunker(p, autoTarget, { count: 2, loadoutKey: 'engineer', spreadStep: 0.42 });
              } else if (trainedUnitType === 'tank') {
                spawnTankFromBunker(p, autoTarget);
              } else if (trainedUnitType === 'apc') {
                spawnAPCFromBunker(p, autoTarget);
              } else if (trainedUnitType === 'jet') {
                success = launchJetSupport(p);
              }
              if (success !== false) {
                p.productionQueue.shift();
                AudioManager.play('target_confirm', { volume: 0.08, duration: 0.14 });
              }
              const nextJob = p.productionQueue[0];
              p.trainingUnitType = nextJob?.unitType || null;
              p.trainingRemaining = nextJob?.duration || 0;
              p.trainingProgress = nextJob ? 0 : 0;
              syncSelectedProductionBuildingMeta();
            }
          }
          if (selectedProductionBuildingIdRef.current === p.id) {
            syncSelectedProductionBuildingMeta();
          }
        }
        if (p.kind === 'aa_site') {
          const aaReloadFactor = abilityActive ? AA_SITE_SURGE_RELOAD_MULTIPLIER : 1;
          const aaDamageFactor = abilityActive ? AA_SITE_SURGE_DAMAGE_MULTIPLIER : 1;
          p.reloadTimer = Math.max(0, (p.reloadTimer || 0) - delta * aaReloadFactor);
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
              targetFlyingKaiju.hp -= AA_SITE_DAMAGE * aaDamageFactor * (targetFlyingKaiju.isMini ? 1.2 : 1);
              if (targetFlyingKaiju.hp <= 0) markKaijuDefeated(targetFlyingKaiju);
              entitiesRef.current.push({
                id: `aa-tracer-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
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
        if (abilityActive && p.kind === 'radar_tower') {
          economyRef.current.radarScanUntil = Math.max(economyRef.current.radarScanUntil || 0, p.abilityActiveUntil || 0);
        }
        if (abilityActive && p.kind === 'tech_lab') {
          economyRef.current.techOverclockUntil = Math.max(economyRef.current.techOverclockUntil || 0, p.abilityActiveUntil || 0);
        }
        if (abilityActive && p.kind === 'war_factory') {
          frameSnapshot.liveTanks.forEach((ally) => {
            if (!ally || ally.dead) return;
            const dist = Math.hypot((ally.x || 0) - p.x, (ally.z || 0) - p.z);
            if (dist < WAR_FACTORY_REFIT_RADIUS) {
              ally.hp = Math.min(ally.maxHp || TANK_BASE_HP, (ally.hp || 0) + delta * 18);
            }
          });
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
         const isAttackMove = p.orderType === 'attack_move';
         const moveTargetX = (p.orderType === 'move' || isAttackMove) ? p.orderX : p.commandTargetX;
         const moveTargetZ = (p.orderType === 'move' || isAttackMove) ? p.orderZ : p.commandTargetZ;
         const orderTarget = p.orderTargetId ? entityLookupRef.current.get(p.orderTargetId) : null;
         if (moveTargetX !== undefined && moveTargetZ !== undefined) {
           let nearbyAttackMoveKaiju = null;
           if (isAttackMove) {
             frameSnapshot.aliveKaijus.forEach((candidate) => {
               if (!candidate || isKaijuDefeated(candidate) || isFlyingKaiju(candidate)) return;
               const dist = Math.hypot((candidate.x || 0) - p.x, (candidate.z || 0) - p.z);
               if (dist <= (p.attackRange || 180) + 70 && (!nearbyAttackMoveKaiju || dist < nearbyAttackMoveKaiju.dist)) {
                 nearbyAttackMoveKaiju = { entity: candidate, dist };
               }
             });
           }
           const cdx = moveTargetX - p.x;
           const cdz = moveTargetZ - p.z;
           const commandDist = Math.sqrt(cdx * cdx + cdz * cdz);
           if (commandDist > 12 && !nearbyAttackMoveKaiju) {
             const cAngle = Math.atan2(cdz, cdx);
             const commandSpeed = (p.combatSpeed || 2.6) * SOLDIER_MOVE_SPEED_MULTIPLIER;
             p.state = 'walking';
             p.aimAngle = cAngle;
             p.vx = Math.cos(cAngle) * commandSpeed;
             p.vz = Math.sin(cAngle) * commandSpeed;

             // Building Avoidance for soldiers
             frameSnapshot.allBunkers.forEach(b => {
               const bdx = p.x - b.x;
               const bdz = p.z - b.z;
               const bd = Math.hypot(bdx, bdz);
               if (bd < 38) {
                 const push = (38 - bd) / 38;
                 p.x += (bdx / Math.max(1, bd)) * push * 4.5;
                 p.z += (bdz / Math.max(1, bd)) * push * 4.5;
               }
             });
             frameSnapshot.liveFacilities.forEach(f => {
               const fdx = p.x - f.x;
               const fdz = p.z - f.z;
               const fd = Math.hypot(fdx, fdz);
               const radius = 42 * (f.visualScale || 1);
               if (fd < radius) {
                 const push = (radius - fd) / radius;
                 p.x += (fdx / Math.max(1, fd)) * push * 4.5;
                 p.z += (fdz / Math.max(1, fd)) * push * 4.5;
               }
             });

             p.x += p.vx * ds;
             p.z += p.vz * ds;
             p.y = getTerrainHeight(p.x, p.z);
             p.hurtTimer = Math.max(0, (p.hurtTimer || 0) - delta);
             return;
           }
           if (!isAttackMove || commandDist <= 12) clearUnitOrder(p);
         }

         if (p.weaponType === 'engineer' && p.orderType === 'repair') {
           const repairTarget = isRepairableCommandTarget(orderTarget) ? orderTarget : null;
           if (repairTarget) {
             const dx = repairTarget.x - p.x;
             const dz = repairTarget.z - p.z;
             const repairDist = Math.hypot(dx, dz);
             const dist = Math.max(0.001, repairDist);
             p.aimAngle = Math.atan2(dz, dx);
             if (repairDist > ENGINEER_REPAIR_RANGE * 0.58) {
               const moveSpeed = (p.combatSpeed || 2.6) * SOLDIER_MOVE_SPEED_MULTIPLIER * 0.9;
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
           clearUnitOrder(p);
         }
         if (p.weaponType === 'engineer') {
           p.repairTargetX = undefined;
           p.repairTargetZ = undefined;
         }

         let nearestKaiju = null;
         let minDist = Infinity;
        if (p.orderType === 'attack' && orderTarget && orderTarget.type === 'kaiju' && !isKaijuDefeated(orderTarget) && !isFlyingKaiju(orderTarget)) {
          nearestKaiju = orderTarget;
          minDist = Math.hypot(orderTarget.x - p.x, orderTarget.z - p.z);
        } else if (isAttackMove) {
          frameSnapshot.aliveKaijus.forEach((candidate) => {
            if (!candidate || isKaijuDefeated(candidate) || isFlyingKaiju(candidate)) return;
            const dist = Math.hypot((candidate.x || 0) - p.x, (candidate.z || 0) - p.z);
            if (dist < minDist) {
              minDist = dist;
              nearestKaiju = candidate;
            }
          });
        }

        if (nearestKaiju) {
           const dx = nearestKaiju.x - p.x;
           const dz = nearestKaiju.z - p.z;
           const aAngle = Math.atan2(dz, dx);
           p.aimAngle = aAngle;
           const attackRange = p.attackRange || 180;
           const idealRange = p.idealRange || 130;
           const retreatRange = p.retreatRange || 72;
           const combatSpeed = p.combatSpeed || 2.7;
           const pressureRange = Math.max(retreatRange, idealRange - 16);
           const holdWindow = 18;
           const formationAngle = p.attackFormationAngle ?? (aAngle + Math.PI);
           const formationRadius = p.attackFormationRadius ?? Math.max(idealRange, 112);
           const anchorX = nearestKaiju.x + Math.cos(formationAngle) * formationRadius;
           const anchorZ = nearestKaiju.z + Math.sin(formationAngle) * formationRadius;
           const anchorDx = anchorX - p.x;
           const anchorDz = anchorZ - p.z;
           const anchorDist = Math.hypot(anchorDx, anchorDz);

           if (p.orderType === 'attack' && minDist > attackRange * 0.9 && anchorDist > 10) {
               const anchorAngle = Math.atan2(anchorDz, anchorDx);
               const approachSpeed = combatSpeed * SOLDIER_MOVE_SPEED_MULTIPLIER * THREE.MathUtils.clamp(anchorDist / 90, 0.44, 0.92);
               p.x += Math.cos(anchorAngle) * approachSpeed * ds;
               p.z += Math.sin(anchorAngle) * approachSpeed * ds;
               p.vx = Math.cos(anchorAngle) * approachSpeed;
               p.vz = Math.sin(anchorAngle) * approachSpeed;
               p.state = 'walking';
           } else if (minDist <= attackRange) {
              p.state = 'attacking_kaiju';
              if (minDist < retreatRange) {
                  p.vx = -Math.cos(aAngle) * combatSpeed * SOLDIER_MOVE_SPEED_MULTIPLIER * 0.92;
                  p.vz = -Math.sin(aAngle) * combatSpeed * SOLDIER_MOVE_SPEED_MULTIPLIER * 0.92;
                  p.x += p.vx * ds;
                  p.z += p.vz * ds;
              } else if (minDist < pressureRange) {
                  const strafeDir = ((p.panicSeed || 0) % 2 > 1 ? 1 : -1);
                  const lateralX = -Math.sin(aAngle) * strafeDir;
                  const lateralZ = Math.cos(aAngle) * strafeDir;
                  p.vx = lateralX * combatSpeed * SOLDIER_MOVE_SPEED_MULTIPLIER * 0.38;
                  p.vz = lateralZ * combatSpeed * SOLDIER_MOVE_SPEED_MULTIPLIER * 0.38;
                  p.x += p.vx * ds;
                  p.z += p.vz * ds;
              } else if (minDist > idealRange + holdWindow) {
                  p.vx = Math.cos(aAngle) * combatSpeed * SOLDIER_MOVE_SPEED_MULTIPLIER * 0.32;
                  p.vz = Math.sin(aAngle) * combatSpeed * SOLDIER_MOVE_SPEED_MULTIPLIER * 0.32;
                  p.x += p.vx * ds;
                  p.z += p.vz * ds;
              } else {
                  p.vx = 0;
                  p.vz = 0;
              }

              const combatNow = Date.now();
              const weaponReady = ensureSoldierWeaponEquipped(p, combatNow);

              if (weaponReady && Math.random() < (p.fireRate || 0.08)) {
                  const shotNow = combatNow;
                  p.firePoseUntil = shotNow + (p.projectileType === 'missile' ? 220 : p.weaponType === 'gunner' ? 140 : 110);
                  p.muzzleFlashUntil = shotNow + (p.projectileType === 'missile' ? 140 : p.weaponType === 'gunner' ? 90 : 70);
                  if (p.projectileType === 'missile') {
                    entitiesRef.current.push({
                      id: `missile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      type: 'missile',
                      x: p.x,
                      y: 14,
                      z: p.z,
                      targetX: nearestKaiju.x,
                      targetY: nearestKaiju.y + 28,
                      targetZ: nearestKaiju.z,
                      damage: p.attackDamage || SOLDIER_RPG_DAMAGE,
                      splashRadius: p.splashRadius || SOLDIER_EXPLOSIVE_SPLASH_RADIUS,
                      speed: p.weaponType === 'missile' ? 11.5 : 9.2,
                      dead: false
                    });
                    AudioManager.play('missile_launch', { volume: p.weaponType === 'missile' ? 0.14 : 0.1, duration: 0.16 });
                  } else {
                    AudioManager.play('gun', {
                      profile: p.weaponType,
                      volume: p.weaponType === 'marksman' ? 0.2 : p.weaponType === 'gunner' ? 0.14 : 0.17
                    });
                    nearestKaiju.hp -= p.attackDamage || SOLDIER_RIFLE_DAMAGE;
                    if (nearestKaiju.hp <= 0) markKaijuDefeated(nearestKaiju);
                    entitiesRef.current.push({
                        id: `bullet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        type: 'bullet',
                        x: p.x, y: 10, z: p.z,
                        targetX: nearestKaiju.x, targetY: nearestKaiju.y + 30, targetZ: nearestKaiju.z,
                        age: 0, dead: false
                    });
                  }
              }
           } else {
               const closeSpeed = combatSpeed * SOLDIER_MOVE_SPEED_MULTIPLIER * 0.52;
               p.x += Math.cos(aAngle) * closeSpeed * ds;
               p.z += Math.sin(aAngle) * closeSpeed * ds;
               p.vx = Math.cos(aAngle) * closeSpeed;
               p.vz = Math.sin(aAngle) * closeSpeed;
               p.state = 'walking';
            }
        } else {
           p.state = 'holding';
           p.vx = THREE.MathUtils.damp(p.vx || 0, 0, 6, delta);
           p.vz = THREE.MathUtils.damp(p.vz || 0, 0, 6, delta);
           if (Math.abs(p.vx) < 0.01) p.vx = 0;
           if (Math.abs(p.vz) < 0.01) p.vz = 0;
           if (p.orderType === 'attack' && (!orderTarget || isKaijuDefeated(orderTarget))) {
             clearUnitOrder(p);
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
                   id: `missile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
            AudioManager.play('jet_engine', { volume: 0.1, duration: 0.42 });
            p.engineSoundTimer = 0;
         }
         
         if (p.fired && (Math.abs(p.x) > 3000 || Math.abs(p.z) > 3000 || p.y > 1000)) p.dead = true;
         // Safety despawn
         if (!p.fired && p.flightAge > 30) p.dead = true;
      }
      else if (p.type === 'warthog') {
         // ─────────────────────────────────────────────────────────────────
         // A-10 WARTHOG STRAFING RUN
         // Flies straight across the target zone at low altitude, fires the
         // GAU-8 Avenger cannon when in range, then exits the map.
         // ─────────────────────────────────────────────────────────────────
         p.flightAge = (p.flightAge || 0) + delta;

         // Constant forward flight
         p.x += (p.vx || 0) * ds;
         p.z += (p.vz || 0) * ds;

         // Low attack pass — close enough to clearly see the plane
         const targetAlt = 128 + Math.sin(p.flightAge * 1.1) * 5;
         p.y = THREE.MathUtils.lerp(p.y, targetAlt, Math.min(1, delta * 1.2));

         const distToTargetX = Math.abs(p.x - p.targetX);

         // Trigger firing and BRRT sound when in range (start early for full strafing run)
         if (!p.fireStarted && !p.fireDone && distToTargetX < 900) {
            p.fireStarted = true;
            AudioManager.play('brrt', { volume: 0.92, duration: 2.8 });
         }

         // Fire strafing rounds while in range
         if (p.fireStarted && !p.fireDone) {
            p.fireTimer = (p.fireTimer || 0) + delta;
            while (p.fireTimer >= p.fireInterval && p.bulletsFired < p.bulletMax) {
               p.fireTimer -= p.fireInterval;
               p.bulletsFired++;

               // Each round impacts near the target with strafing spread
               const spread = 42;
               const impactX = p.targetX + (Math.random() - 0.5) * spread;
               const impactZ = p.targetZ + (p.bulletsFired - p.bulletMax * 0.5) * 5.5 * (p.vx > 0 ? 1 : -1) + (Math.random() - 0.5) * 18;
               const impactY = getTerrainHeight(impactX, impactZ) + 2;

               // Spawn a visible tracer bullet
               entitiesRef.current.push({
                  id: `warthog-round-${Date.now()}-${p.bulletsFired}`,
                  type: 'bullet',
                  x: p.x + (p.vx > 0 ? 62 : -62) * WARTHOG_MODEL_SCALE,
                  y: p.y - 3 * WARTHOG_MODEL_SCALE,
                  z: p.z - 1.4 * WARTHOG_MODEL_SCALE,
                  targetX: impactX,
                  targetY: impactY,
                  targetZ: impactZ,
                  age: 0,
                  dead: false
               });

               // Damage kaijus in splash radius + stagger nearby enemies (GAU-8 concussion)
               const splash = 28;
               const damageBase = 36 * (getFacilityStrikeDamageMultiplier ? getFacilityStrikeDamageMultiplier() : 1);
               frameSnapshot.aliveKaijus.forEach((k) => {
                  const kd = Math.hypot((k.x || 0) - impactX, (k.z || 0) - impactZ);
                  if (kd < splash + 52) {
                     const dmg = damageBase * Math.max(0.25, 1 - kd / (splash + 52));
                     applyKaijuElementalDamage(k, dmg, 'warthog_run');
                     if (k.hp <= 0) markKaijuDefeated(k);
                  }
                  // Gimmick: shockwave from 30mm rounds staggers kaijus within 90 units
                  if (kd < 90) {
                     k.staggered = true;
                     k.staggerTimer = Math.max(k.staggerTimer || 0, 20 + Math.random() * 18);
                  }
               });

               // Ground impact effects — GAU-8 Avenger 30mm cannon impact
               // Every round: bright explosion flash at impact (white flash → orange fireball → smoke)
               entitiesRef.current.push({
                  id: `gau8-impact-${Date.now()}-${p.bulletsFired}`,
                  type: 'missile_impact',
                  x: impactX, y: impactY, z: impactZ,
                  dead: false
               });
               // Dirt / debris cloud rising out of the crater
               pushImpactPuffEntity(entitiesRef.current, impactX, impactZ, impactY + 6);
               // Every other round: secondary offset burst (spall, secondary detonation)
               if (p.bulletsFired % 2 === 0) {
                  entitiesRef.current.push({
                     id: `gau8-burst-${Date.now()}-${p.bulletsFired}`,
                     type: 'missile_impact',
                     x: impactX + (Math.random() - 0.5) * 22,
                     y: impactY + 2,
                     z: impactZ + (Math.random() - 0.5) * 22,
                     dead: false
                  });
               }
               // Scorch / crater mark every 3rd round — large burning crater
               if (p.bulletsFired % 3 === 0) {
                  pushScorchEntity(entitiesRef.current, impactX, impactZ, 18 + Math.random() * 14, {
                     kind: 'gau8_crater', temporary: true, ttl: 6 + Math.random() * 5,
                     baseColor: '#1a0e04', ringColor: '#3d1f06', coreColor: '#e07010', heatColor: '#f09030',
                     baseOpacity: 0.82, coreOpacity: 0.48, heatOpacity: 0.22,
                     smokeCount: 2, flameCount: 2, firePulseSpeed: 7.0, smokeDrift: 4.2,
                     burnRadius: 40, damagePerSecond: 0, affectsFlying: false
                  });
               }
               // Every 5th round: heavy-hit cluster — 3 rapid successive blasts in tight spread
               if (p.bulletsFired % 5 === 0) {
                  for (let b = 0; b < 3; b++) {
                     entitiesRef.current.push({
                        id: `gau8-cluster-${Date.now()}-${p.bulletsFired}-${b}`,
                        type: 'missile_impact',
                        x: impactX + (Math.random() - 0.5) * 34,
                        y: impactY + b * 3,
                        z: impactZ + (Math.random() - 0.5) * 34,
                        dead: false
                     });
                  }
               }
            }

            if (p.bulletsFired >= p.bulletMax) {
               p.fireDone = true;
               // Throttle up and climb away
               p.vx *= 1.12;
               p.y += 14 * ds;
               // Leave burning scorch streak along the whole strafing path
               for (let streak = 0; streak < 8; streak++) {
                  const sx = p.targetX + (streak - 3.5) * 28 * (p.vx > 0 ? -1 : 1);
                  const sz = p.targetZ + (Math.random() - 0.5) * 44;
                  pushScorchEntity(entitiesRef.current, sx, sz, 18 + Math.random() * 16, {
                     kind: 'gau8_streak', temporary: true, ttl: 8 + Math.random() * 6,
                     baseColor: '#120a04', ringColor: '#2a1206', coreColor: '#b05812', heatColor: '#d07828',
                     baseOpacity: 0.72, coreOpacity: 0.34, heatOpacity: 0.14,
                     smokeCount: 3, flameCount: 2, smokeDrift: 3.2, burnRadius: 38
                  });
               }
               // Finale: extra explosion bursts scattered across the strafing path
               for (let finale = 0; finale < 4; finale++) {
                  entitiesRef.current.push({
                     id: `gau8-finale-${Date.now()}-${finale}`,
                     type: 'missile_impact',
                     x: p.targetX + (Math.random() - 0.5) * 90,
                     y: getTerrainHeight(p.targetX, p.targetZ) + 2,
                     z: p.targetZ + (Math.random() - 0.5) * 90,
                     dead: false
                  });
               }
               // Screen shake — the whole earth shook from the strafing run
               window.dispatchEvent(new CustomEvent('fallout-explosion', {
                  detail: { intensity: 1.1, type: 'kinetic_spear', x: p.targetX, z: p.targetZ }
               }));
               // Deep thud resonance as the strafing run ends
               AudioManager.play('bomb', { volume: 0.28, duration: 0.6 });
               // Strafing craters — 3 shallow bowls spaced along the firing line
               if (typeof window._falloutAddCrater === 'function') {
                  for (let cr = 0; cr < 3; cr++) {
                     window._falloutAddCrater({
                        type: 'warthog',
                        x: p.targetX + (Math.random() - 0.5) * 38,
                        z: p.targetZ + (cr - 1) * 54 * (p.vx > 0 ? 1 : -1) + (Math.random() - 0.5) * 18,
                        radius: 28 + Math.random() * 14,
                        depth:  10 + Math.random() * 5
                     });
                  }
               }
            }
         }

         // Engine sound loop
         p.engineSoundTimer = (p.engineSoundTimer || 0) + ds;
         if (p.engineSoundTimer > 72) {
            AudioManager.play('jet_engine', { volume: 0.09, duration: 0.38 });
            p.engineSoundTimer = 0;
         }

         // Despawn after exiting map
         if (p.fireDone && (Math.abs(p.x) > 4800 || Math.abs(p.z) > 4800)) p.dead = true;
         // Safety despawn — extended for long approach distances
         if (!p.fireDone && p.flightAge > 45) p.dead = true;
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
               id: `missile-impact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
               type: 'missile_impact',
               x: p.targetX, y: p.targetY, z: p.targetZ,
               dead: false
            });
            
            // Damage Kaiju
            frameSnapshot.aliveKaijus.forEach(k => {
               const kd = Math.sqrt(Math.pow(k.x - p.targetX, 2) + Math.pow(k.z - p.targetZ, 2));
               const splashRadius = p.splashRadius || 150;
               const splashDamage = p.damage || JET_MISSILE_DAMAGE;
               if (kd < splashRadius) {
                  k.hp -= splashDamage * Math.max(0.42, 1 - kd / splashRadius);
                  if (k.hp <= 0) markKaijuDefeated(k);
               }
            });
            AudioManager.play('bomb');
         } else {
            const speed = p.speed || 14;
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
          target: clampStrikeTarget(target),
          sourceBuildingId: selectedProductionBuildingIdRef.current || null
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
    if (targetingRef.current.armedSupportKey) {
      launchSupportStrike(targetingRef.current.armedSupportKey, target);
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
    if (targetingRef.current.pendingBuild || targetingRef.current.pendingDeploy || targetingRef.current.armedSupportKey) {
      window._falloutBuildFallbackTarget = nextTarget;
    }
    if (targetingRef.current.pendingDeploy && deployDragRef.current.active) {
      setDeployDragTarget(nextTarget);
    }
  };

  useEffect(() => {
    const canvas = gl?.domElement;
    if (!canvas) return undefined;
    const resolveSelectableUnit = (clientX, clientY) => (
      getClosestProjectedEntity(
        clientX,
        clientY,
        entitiesRef.current.filter(isCommandableUnit),
        canvas.getBoundingClientRect(),
        26
      )
    );
    const resolveSelectableProductionBuilding = (clientX, clientY) => (
      getClosestProjectedEntity(
        clientX,
        clientY,
        getProductionFacilities().filter((entity) => !!getFacilityInteractionOption(entity.kind) || (BUILDING_DEPLOY_OPTIONS[entity.kind] || []).length > 0),
        canvas.getBoundingClientRect(),
        34
      )
    );
    const resolveCommandTarget = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const hoveredKaiju = getClosestProjectedEntity(clientX, clientY, getAliveKaijus(), rect, 42);
      if (hoveredKaiju) return { type: 'kaiju', entity: hoveredKaiju };
      const hoveredRepairTarget = getClosestProjectedEntity(
        clientX,
        clientY,
        entitiesRef.current.filter(isRepairableCommandTarget),
        rect,
        34
      );
      if (hoveredRepairTarget) return { type: 'repair', entity: hoveredRepairTarget };
      const terrainTarget = getPointerStrikeTargetFromClient(clientX, clientY);
      if (terrainTarget) return { type: 'ground', target: terrainTarget };
      return null;
    };

    const resolveActionTarget = (clientX, clientY) => (
      getPointerStrikeTargetFromClient(clientX, clientY)
      || window._falloutBuildPlacementTarget
      || deployDragRef.current.target
      || window._falloutMouseTarget
      || window._falloutBuildFallbackTarget
      || null
    );

    const handleCanvasPointerDown = (event) => {
      if (event.button === 2) {
        const selectedUnits = getSelectedUnits();
        if (!selectedUnits.length || targetingRef.current.pendingDeploy || targetingRef.current.pendingBuild || targetingRef.current.armedSupportKey) return;
        const commandTarget = resolveCommandTarget(event.clientX, event.clientY);
        if (!commandTarget) return;
        event.preventDefault();
        if (commandTarget.type === 'kaiju') {
          issueGroupAttackOrder(
            selectedUnits.filter((unit) => !(unit.type === 'tank' && isFlyingKaiju(commandTarget.entity))),
            commandTarget.entity
          );
          AudioManager.play('target_confirm', { volume: 0.08, duration: 0.12 });
          return;
        }
        if (commandTarget.type === 'repair') {
          selectedUnits.forEach((unit) => {
            if (unit.type === 'soldier' && unit.weaponType === 'engineer') issueRepairOrder(unit, commandTarget.entity);
            else issueMoveOrder(unit, { x: commandTarget.entity.x, z: commandTarget.entity.z });
          });
          AudioManager.play('target_confirm', { volume: 0.08, duration: 0.12 });
          return;
        }
        issueGroupMoveOrder(selectedUnits, commandTarget.target, { attackMove: false });
        AudioManager.play('target_confirm', { volume: 0.08, duration: 0.12 });
        return;
      }
      if (event.button !== 0) return;
      const nextTarget = getPointerStrikeTargetFromClient(event.clientX, event.clientY);
      if (nextTarget) syncPointerPreviewTarget(nextTarget);
      if (targetingRef.current.pendingDeploy) {
        if (!nextTarget) return;
        deployDragRef.current.active = true;
        setDeployDragTarget(nextTarget);
        window._falloutDeployDragActive = true;
        return;
      }
      if (targetingRef.current.pendingBuild || targetingRef.current.armedSupportKey) return;
      selectionRef.current.active = true;
      selectionRef.current.moved = false;
      selectionRef.current.startClientX = event.clientX;
      selectionRef.current.startClientY = event.clientY;
      selectionRef.current.endClientX = event.clientX;
      selectionRef.current.endClientY = event.clientY;
      syncSelectionOverlay();
    };

    const handleCanvasPointerMove = (event) => {
      const nextTarget = getPointerStrikeTargetFromClient(event.clientX, event.clientY);
      if (nextTarget) syncPointerPreviewTarget(nextTarget);
      if (selectionRef.current.active && !targetingRef.current.pendingDeploy && !targetingRef.current.pendingBuild && !targetingRef.current.armedSupportKey) {
        selectionRef.current.endClientX = event.clientX;
        selectionRef.current.endClientY = event.clientY;
        const dragDist = Math.hypot(
          selectionRef.current.endClientX - selectionRef.current.startClientX,
          selectionRef.current.endClientY - selectionRef.current.startClientY
        );
        selectionRef.current.moved = dragDist > 10;
        syncSelectionOverlay();
      }
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
      if (targetingRef.current.armedSupportKey && nextTarget) {
        deployManualStrike(nextTarget);
        return;
      }
      if (selectionRef.current.active) {
        const rect = canvas.getBoundingClientRect();
        if (selectionRef.current.moved) {
          const units = getSelectionBoxUnits(rect);
          if (units.length) {
            setSelectedUnits(units, event.shiftKey);
            clearSelectedProductionBuilding();
          } else if (!event.shiftKey) {
            clearUnitSelection();
            clearSelectedProductionBuilding();
          }
        } else {
          const clickedUnit = resolveSelectableUnit(event.clientX, event.clientY);
          if (clickedUnit) {
            setSelectedUnits([clickedUnit], event.shiftKey);
            clearSelectedProductionBuilding();
          } else {
            const clickedBuilding = resolveSelectableProductionBuilding(event.clientX, event.clientY);
            if (clickedBuilding) {
              if (!event.shiftKey) clearUnitSelection();
              setSelectedProductionBuilding(clickedBuilding);
            } else if (!event.shiftKey) {
              clearUnitSelection();
              clearSelectedProductionBuilding();
            }
          }
        }
        selectionRef.current.active = false;
        selectionRef.current.moved = false;
        window._falloutSelectionBox = null;
      }
    };

    const handleCanvasDoubleClick = (event) => {
      if (event.button !== 0) return;
      const clickedUnit = resolveSelectableUnit(event.clientX, event.clientY);
      if (clickedUnit) {
        const units = entitiesRef.current.filter((entity) => {
          if (!isCommandableUnit(entity)) return false;
          if (entity.type !== clickedUnit.type) return false;
          // For soldiers, they must share the same weapon type (rifleman, sniper, etc)
          if (entity.type === 'soldier' && entity.weaponType !== clickedUnit.weaponType) return false;
          return true;
        });
        if (units.length) {
          const pulseDuration = 1000;
          const pulseUntil = Date.now() + pulseDuration;
          units.forEach((u) => {
            u.selectionPulseUntil = pulseUntil;
          });
          setSelectedUnits(units, event.shiftKey);
          clearSelectedProductionBuilding();
          const unitTypeName = getUnitTypeName(clickedUnit);
          showCommandFeedback(`Selected ${units.length} ${unitTypeName}${units.length > 1 ? (unitTypeName.endsWith('s') ? "'" : "s") : ""}`);
          if (typeof AudioManager !== 'undefined') {
            AudioManager.play('target_confirm', { volume: 0.12, duration: 0.16 });
          }
        }
      }
    };

    const handleCanvasPointerLeave = () => {
      if (!targetingRef.current.pendingDeploy && !targetingRef.current.pendingBuild && !targetingRef.current.armedSupportKey) {
        window._falloutMouseTarget = null;
      }
      if (!deployDragRef.current.active) clearDeployDrag();
      selectionRef.current.active = false;
      selectionRef.current.moved = false;
      window._falloutSelectionBox = null;
    };
    const handleContextMenu = (event) => {
      if (getSelectedUnits().length) event.preventDefault();
    };

    canvas.addEventListener('pointerdown', handleCanvasPointerDown);
    canvas.addEventListener('pointermove', handleCanvasPointerMove);
    canvas.addEventListener('pointerup', handleCanvasPointerUp);
    canvas.addEventListener('dblclick', handleCanvasDoubleClick);
    canvas.addEventListener('pointerleave', handleCanvasPointerLeave);
    canvas.addEventListener('contextmenu', handleContextMenu);

    return () => {
      canvas.removeEventListener('pointerdown', handleCanvasPointerDown);
      canvas.removeEventListener('pointermove', handleCanvasPointerMove);
      canvas.removeEventListener('pointerup', handleCanvasPointerUp);
      canvas.removeEventListener('dblclick', handleCanvasDoubleClick);
      canvas.removeEventListener('pointerleave', handleCanvasPointerLeave);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [camera, gl]);

  if (!mounted) return null;

  return (
    <>
      <DynamicEntitySync entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} frameSnapshotRef={frameSnapshotRef} setGameState={setGameState} qualityProfile={qualityProfile} />
      <DummyWarmup qualityProfile={qualityProfile} />
      {/* PERFECT STATIC RENDER: Only runs once on mount! Everything moves natively via WebGL updates, saving 1500 React node reconciliations! */}
      {entitiesRef.current.map((p, idx) => {
        if (p.type === 'person') return <EntityPerson key={p.id} index={idx} entitiesRef={entitiesRef} qualityProfile={qualityProfile} />;
        if (p.type === 'car') return <EntityCar key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'bird') return <EntityBird key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'house') return <EntityHouse key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'tree') return <EntityTree key={p.id} index={idx} entitiesRef={entitiesRef} />;
        if (p.type === 'bunker') return <MemoEntityBunker key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        if (p.type === 'barricade') return <MemoEntityBarricade key={p.id} entityId={p.id} entitiesRef={entitiesRef} entityLookupRef={entityLookupRef} />;
        return null;
      })}
      {/* RUGGED MOUNTAIN TERRAIN */}
      <MountainTerrain themeConfig={themeConfig} environmentVariant={environmentVariant} pollution={pollution} qualityProfile={qualityProfile} />

      <TargetIndicator />
      <GroupSelectionIndicator entitiesRef={entitiesRef} />
      <UnitCommandMarkers />
      <ProductionBuildingIndicator entitiesRef={entitiesRef} />
      <AttackTargetIndicator entitiesRef={entitiesRef} />
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
    supportOptions: SUPPORT_STRIKE_OPTIONS,
    armedSupportKey: null,
    supportCooldowns: { nuke: 0, ...createDefaultSupportCooldownMap() },
    supportCanArm: createDefaultSupportCanArmMap(),
    selectedProductionBuilding: null,
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
  const [activePanel, setActivePanel] = useState('build');
  const [buildPanelMode, setBuildPanelMode] = useState('structures');
  const [showTechMap, setShowTechMap] = useState(false);
  const [showBunkerDetails, setShowBunkerDetails] = useState(false);
  const [showSupportPanel, setShowSupportPanel] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [commandFeedback, setCommandFeedback] = useState(null);
  const feedbackTimerRef = useRef(null);

  useEffect(() => {
    const handleFeedback = (event) => {
      setCommandFeedback(event.detail.text);
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = setTimeout(() => setCommandFeedback(null), 3500);
    };
    window.addEventListener('fallout-command-feedback', handleFeedback);
    return () => {
      window.removeEventListener('fallout-command-feedback', handleFeedback);
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);
  
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
      
      const nextArmedSupportKey = window._falloutArmedSupportKey || (window._falloutManualStrikeArmed ? 'nuke' : null);
      const nextSupportOptions = window._falloutGameStats?.supportOptions || SUPPORT_STRIKE_OPTIONS;
      if (nextBombCamActive) setLockStatus('GUIDE');
      else if (nextArmedSupportKey) setLockStatus(nextSupportOptions[nextArmedSupportKey]?.statusLabel || 'STRIKE');
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
  }, [pendingBuild]);

  const isStrikeLocked = lockStatus === 'READY' || lockStatus === 'INBOUND' || lockStatus === 'PLACE' || lockStatus === 'GUIDE' || lockStatus === 'BUILD' || lockStatus === 'SITE';
  const aliveBunkerCount = stats.bunkers.filter(b => !b.dead).length;
  const activeKaijus = stats.kaijus.filter(k => !k.dead);
  const activeFlyingKaijus = activeKaijus.filter(k => isFlyingKaijuVariant(k.variant));
  const bunkerHealthRatio = stats.bunkers.length
    ? stats.bunkers.reduce((sum, bunker) => sum + Math.max(0, bunker.hp || 0), 0) / Math.max(1, stats.bunkers.reduce((sum, bunker) => sum + Math.max(1, bunker.maxHp || 0), 0))
    : 0;
  const hasAASite = !!stats.buildState?.aa_site;
  const hasBattlefieldPressure = activeKaijus.length > 0 || !!stats.wave?.intermission;
  const missionStepLabel = stats.wave?.intermission
    ? `Step 2/2: Redeploy for Level ${stats.wave?.upcomingLevel || stats.wave?.level || 1}`
    : `Step 1/2: Eliminate ${stats.wave?.remainingKaijus || 0} hostiles`;
  const visibleDeployOptions = Object.entries(stats.deployCosts || DEPLOY_OPTIONS);
  const pendingDeployOption = pendingDeploy ? (stats.deployCosts || DEPLOY_OPTIONS)[pendingDeploy] : null;
  const pendingBuildOption = pendingBuild ? (stats.buildOptions || BUILD_OPTIONS)[pendingBuild] : null;
  const supportOptions = stats.supportOptions || SUPPORT_STRIKE_OPTIONS;
  const armedSupportKey = stats.armedSupportKey || (stats.nukeArmed ? 'nuke' : null);
  const supportCooldowns = stats.supportCooldowns || { nuke: 0, ...createDefaultSupportCooldownMap() };
  const supportCanArm = stats.supportCanArm || createDefaultSupportCanArmMap();
  const activeSupportOption = armedSupportKey ? supportOptions[armedSupportKey] : null;
  const selection = stats.selection || { count: 0, squads: 0, engineers: 0, armor: 0 };
  const selectedProductionBuilding = stats.selectedProductionBuilding || null;
  const productionQueue = selectedProductionBuilding?.queue || [];
  const selectedBuildingAction = selectedProductionBuilding?.action || null;
  const queueCounts = productionQueue.reduce((acc, unitType) => {
    acc[unitType] = (acc[unitType] || 0) + 1;
    return acc;
  }, {});
  const currentSupportCooldownMs = armedSupportKey ? (supportCooldowns[armedSupportKey] || 0) : cooldownMs;
  const activeSupportAdvantageCount = activeSupportOption
    ? activeKaijus.filter((k) => k.weakAgainst === activeSupportOption.element).length
    : 0;
  const visibleBuildOptions = Object.entries(stats.buildOptions || BUILD_OPTIONS);
  const visibleDeployPanelOptions = selectedProductionBuilding?.kind
    ? visibleDeployOptions.filter(([key]) => canBuildingProduceUnit(selectedProductionBuilding.kind, key))
    : visibleDeployOptions;
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
    window.dispatchEvent(new CustomEvent('fallout-select-deploy', {
      detail: {
        unitType,
        sourceBuildingId: selectedProductionBuilding?.id || null
      }
    }));
  };
  const handleProductionModalClose = () => {
    window.dispatchEvent(new CustomEvent('fallout-clear-production-building'));
  };
  const handleFacilityActionClick = () => {
    if (!selectedProductionBuilding?.id) return;
    window.dispatchEvent(new CustomEvent('fallout-facility-action', {
      detail: { facilityId: selectedProductionBuilding.id }
    }));
  };
  const handleBuildClick = (buildingType) => {
    window.dispatchEvent(new CustomEvent('fallout-select-building', { detail: { buildingType } }));
  };
  const handleUpgradeClick = (upgradeType) => {
    window.dispatchEvent(new CustomEvent('fallout-purchase-upgrade', { detail: { upgradeType } }));
  };
  const handleControlGroupClick = (groupKey) => {
    window.dispatchEvent(new CustomEvent('fallout-select-control-group', { detail: { groupKey } }));
  };
  const handleSupportClick = (abilityKey) => {
    window.dispatchEvent(new CustomEvent('fallout-arm-support', { detail: { abilityKey } }));
  };
  const handleNukeClick = () => {
    handleSupportClick('nuke');
  };

  const objectiveText = activeSupportOption
    ? `${activeSupportOption.label} armed: click land to fire ($${activeSupportOption.cost})${activeSupportAdvantageCount > 0 ? ` • bonus on ${activeSupportAdvantageCount} target${activeSupportAdvantageCount > 1 ? 's' : ''}` : ''}`
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
    background: 'linear-gradient(180deg, rgba(3,10,24,0.82), rgba(4,18,24,0.72))',
    backdropFilter: 'blur(14px)',
    border: '1px solid rgba(148,163,184,0.16)',
    borderRadius: '18px',
    boxShadow: '0 12px 36px rgba(2,8,23,0.28), inset 0 1px 0 rgba(255,255,255,0.05)',
    padding: '12px 14px',
    marginBottom: '8px'
  };
  const compactScroller = {
    maxHeight: '34vh',
    overflowY: 'auto',
    paddingRight: '4px',
    scrollbarWidth: 'thin'
  };
  const commandDockStyle = {
    ...card,
    maxHeight: '38vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  };
  const panelScroller = {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    paddingRight: '4px',
    scrollbarWidth: 'thin'
  };
  const supportButtonStyle = (active, disabled, optionKey) => ({
    borderRadius: '12px',
    border: active ? '1px solid rgba(248,113,113,0.9)' : `1px solid ${optionKey === 'orbital_lance' ? 'rgba(56,189,248,0.38)' : optionKey === 'firestorm' ? 'rgba(249,115,22,0.34)' : optionKey === 'kinetic_spear' ? 'rgba(226,232,240,0.34)' : 'rgba(249,115,22,0.3)'}`,
    background: active
      ? (optionKey === 'orbital_lance' ? 'rgba(8,47,73,0.5)' : optionKey === 'firestorm' ? 'rgba(124,45,18,0.5)' : optionKey === 'kinetic_spear' ? 'rgba(30,41,59,0.58)' : 'rgba(127,29,29,0.4)')
      : disabled
      ? 'rgba(255,255,255,0.04)'
      : 'linear-gradient(180deg, rgba(15,23,42,0.62), rgba(15,23,42,0.4))',
    color: active ? '#f8fafc' : disabled ? '#64748b' : '#e2e8f0'
  });

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
              Moving to {stats.wave?.nextSectorName || stats.wave?.sectorName || 'next sector'} • {stats.wave?.environmentLabel || 'Frontier'} for level {stats.wave?.upcomingLevel || stats.wave?.level || 1} in {stats.wave?.nextWaveSeconds || 0}s
            </div>
          </div>
        </div>
      )}
      <div
        className="fallout-ui-area absolute top-3 left-3 z-30 select-none"
        style={{ display: 'flex', alignItems: 'stretch', pointerEvents: 'none', transform: leftPanelCollapsed ? 'translateX(calc(-100% + 28px))' : 'translateX(0)', transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)' }}
      >
        <div style={{ fontFamily: "'Courier New', monospace", width: 'min(92vw, 390px)', maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', paddingRight: '4px', pointerEvents: 'auto' }}>
        <div style={{ ...card, padding: '10px 12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto', alignItems: 'center', gap: '10px', fontSize: '12px', color: '#e2e8f0' }}>
          <span style={{ fontWeight: 700, color: '#f8fafc' }}>💰 {stats.credits}</span>
          <span style={{ color: '#cbd5e1' }}>+{stats.incomePerSecond || 0}/s</span>
          <span style={{ justifySelf: 'end', color: '#f8fafc' }}>{stats.wave?.intermission ? `NEXT ${stats.wave?.nextWaveSeconds || 0}s` : `${stats.wave?.remainingKaijus || 0} HOSTILES`}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '8px', gap: '10px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.16em' }}>
              STATUS {lockStatus} • LV {stats.wave?.level || 1}/{stats.wave?.totalLevels || TOTAL_KAIJU_LEVELS}
            </div>
            <div style={{ marginTop: '4px', fontSize: '10px', color: '#86efac', letterSpacing: '0.11em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              SECTOR {stats.wave?.sectorName || 'Village'} • {stats.wave?.environmentLabel || 'Frontier'} • {missionStepLabel}
            </div>
            {selection.count > 0 && (
              <div style={{ marginTop: '5px', fontSize: '9px', color: '#bfdbfe', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Selected {selection.count} • Inf {selection.squads} • Eng {selection.engineers} • Armor {selection.armor}
              </div>
            )}
          </div>
          {stats.wave?.intermission && (
            <div style={{ flexShrink: 0, fontSize: '9px', color: '#bbf7d0', letterSpacing: '0.12em', textAlign: 'right' }}>
              NEXT {stats.wave?.nextSectorName || stats.wave?.sectorName || 'Village'}
            </div>
          )}
        </div>
        <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <div style={{ fontSize: '9px', color: '#94a3b8', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
            Strike Console
          </div>
          <button
            onClick={() => setShowSupportPanel((value) => !value)}
            style={{
              borderRadius: '999px',
              border: '1px solid rgba(148,163,184,0.22)',
              background: 'rgba(15,23,42,0.42)',
              color: '#cbd5e1',
              padding: '4px 8px',
              fontSize: '8px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase'
            }}
          >
            {showSupportPanel ? 'Compact' : 'Expand'}
          </button>
        </div>
        <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px' }}>
          {Object.values(supportOptions).map((option) => {
            const active = armedSupportKey === option.key;
            const hasReq = hasPrerequisites(buildPlacementState, option.requires || []);
            const cooldown = supportCooldowns[option.key] || 0;
            const affordable = stats.credits >= option.cost;
            const canArm = !!supportCanArm[option.key];
            const elementMeta = getElementMeta(option.element);
            const strongTargets = activeKaijus.filter((k) => k.weakAgainst === option.element).length;
            const resistantTargets = activeKaijus.filter((k) => k.resistAgainst === option.element).length;
            const waiting = !active && hasReq && cooldown <= 0 && affordable && !canArm;
            const disabled = !active && (!hasReq || cooldown > 0 || !affordable || waiting);
            const badge = !hasReq
              ? 'LOCK'
              : active
              ? 'ACTIVE'
              : cooldown > 0
              ? `${Math.ceil(cooldown / 1000)}s`
              : !affordable
              ? 'LOW'
              : waiting
              ? 'WAIT'
              : `$${option.cost}`;
            return (
              <button
                key={option.key}
                onClick={() => handleSupportClick(option.key)}
                disabled={disabled}
                style={{
                  ...supportButtonStyle(active, disabled, option.key),
                  padding: showSupportPanel ? '9px 10px' : '8px 9px',
                  fontSize: '9px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: showSupportPanel ? '4px' : '2px',
                  alignItems: 'flex-start',
                  minHeight: showSupportPanel ? '62px' : '46px',
                  textAlign: 'left'
                }}
              >
                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {option.icon} {option.label}
                    </div>
                    <div style={{ marginTop: showSupportPanel ? '2px' : '1px', fontSize: '7px', color: elementMeta.color, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
                      {elementMeta.shortLabel}
                    </div>
                  </div>
                  <span style={{ fontSize: '8px', color: active ? '#fecaca' : '#cbd5e1', letterSpacing: '0.18em', textTransform: 'uppercase', flexShrink: 0 }}>
                    {badge}
                  </span>
                </div>
                {showSupportPanel && (
                  <div style={{ fontSize: '7px', color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    {strongTargets > 0 ? `+${strongTargets} weak` : resistantTargets > 0 ? `${resistantTargets} resist` : 'ready'}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {currentSupportCooldownMs > 0 && activeSupportOption && (
          <div style={{ marginTop: '6px', height: '4px', borderRadius: '4px', background: '#1f2937', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.max(0, 100 - Math.min(100, (currentSupportCooldownMs / activeSupportOption.cooldownMs) * 100))}%`,
                background: activeSupportOption.key === 'orbital_lance' ? '#38bdf8' : activeSupportOption.key === 'firestorm' ? '#f97316' : '#f97316'
              }}
            />
          </div>
        )}
        {!currentSupportCooldownMs && targetLock > 0 && (
          <div style={{ marginTop: '6px', height: '4px', borderRadius: '4px', background: '#1f2937', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.floor(targetLock * 100)}%`, background: '#ef4444' }} />
          </div>
        )}
        {commandFeedback && (
          <div
            style={{
              marginTop: '8px',
              borderRadius: '10px',
              border: '1px solid rgba(74,222,128,0.4)',
              background: 'rgba(6,78,59,0.3)',
              padding: '6px 10px',
              fontSize: '9px',
              color: '#86efac',
              fontWeight: 'bold',
              letterSpacing: '0.04em',
              textTransform: 'uppercase'
            }}
          >
             {commandFeedback}
          </div>
        )}
        <div
          style={{
            marginTop: '8px',
            borderRadius: '12px',
            border: '1px solid rgba(148,163,184,0.16)',
            background: 'linear-gradient(180deg, rgba(15,23,42,0.7), rgba(15,23,42,0.5))',
            padding: '7px 10px',
            fontSize: '8px',
            color: '#dbeafe',
            lineHeight: 1.4
          }}
        >
          {objectiveText}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showBunkerDetails ? '10px' : 0 }}>
          <div style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.18em' }}>BUNKERS</div>
          <button
            onClick={() => setShowBunkerDetails((value) => !value)}
            style={{
              borderRadius: '999px',
              border: '1px solid rgba(148,163,184,0.22)',
              background: 'rgba(15,23,42,0.4)',
              color: '#cbd5e1',
              padding: '4px 8px',
              fontSize: '8px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase'
            }}
          >
            {showBunkerDetails ? 'Hide' : 'Show'}
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '10px', color: '#e2e8f0', marginBottom: showBunkerDetails ? '8px' : 0 }}>
          <span>{aliveBunkerCount}/{stats.bunkers.length} online</span>
          <span>{Math.round(bunkerHealthRatio * 100)}% integrity</span>
        </div>
        {showBunkerDetails && stats.bunkers.map((b, i) => (
          <div key={i} style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: b.hp <= 0 ? '#ef4444' : '#e2e8f0' }}>
              <span>{b.hp <= 0 ? '💀' : '🛡️'} #{i + 1}</span>
              <span>{b.hp <= 0 ? 'DESTROYED' : `${Math.round(b.hp)}/${b.maxHp}`}</span>
            </div>
            <div style={{ height: '6px', background: 'rgba(30,41,59,0.9)', borderRadius: '999px', overflow: 'hidden', marginTop: '6px' }}>
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

        <div style={commandDockStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px', position: 'sticky', top: 0, background: 'linear-gradient(180deg, rgba(3,10,24,0.92), rgba(3,10,24,0.72))', paddingBottom: '8px', zIndex: 1 }}>
          {[
            { key: 'build', label: 'Build' },
            { key: 'threat', label: `Threat (${activeKaijus.length})` }
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActivePanel(tab.key)}
              style={{
                borderRadius: '12px',
                border: activePanel === tab.key ? '1px solid rgba(16,185,129,0.9)' : '1px solid rgba(148,163,184,0.25)',
                background: activePanel === tab.key ? 'linear-gradient(180deg, rgba(6,95,70,0.5), rgba(6,78,59,0.35))' : 'linear-gradient(180deg, rgba(15,23,42,0.52), rgba(15,23,42,0.36))',
                color: activePanel === tab.key ? '#ecfdf5' : '#cbd5e1',
                fontSize: '10px',
                padding: '9px 8px',
                textTransform: 'uppercase',
                letterSpacing: '0.08em'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={panelScroller}>
          {activePanel === 'build' && (
            <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
              {[
                { key: 'structures', label: 'Structures' },
                { key: 'upgrades', label: 'Upgrades' }
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setBuildPanelMode(tab.key)}
                  style={{
                    borderRadius: '10px',
                    border: buildPanelMode === tab.key ? '1px solid rgba(34,197,94,0.75)' : '1px solid rgba(148,163,184,0.2)',
                    background: buildPanelMode === tab.key ? 'rgba(6,95,70,0.34)' : 'rgba(15,23,42,0.32)',
                    color: buildPanelMode === tab.key ? '#ecfdf5' : '#cbd5e1',
                    padding: '8px 6px',
                    fontSize: '9px',
                    textTransform: 'uppercase'
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div
              style={{
                borderRadius: '14px',
                border: '1px solid rgba(34,197,94,0.18)',
                background: 'linear-gradient(180deg, rgba(5,46,22,0.38), rgba(15,23,42,0.55))',
                padding: '10px 12px',
                marginBottom: '10px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showTechMap ? '10px' : 0 }}>
                <div style={{ fontSize: '10px', color: '#86efac', letterSpacing: '0.18em' }}>TECH MAP</div>
                <button
                  onClick={() => setShowTechMap((value) => !value)}
                  style={{
                    borderRadius: '999px',
                    border: '1px solid rgba(148,163,184,0.22)',
                    background: 'rgba(15,23,42,0.42)',
                    color: '#cbd5e1',
                    padding: '4px 8px',
                    fontSize: '8px',
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase'
                  }}
                >
                  {showTechMap ? 'Hide' : 'Show'}
                </button>
              </div>
              {showTechMap && (
                <>
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {techTreeRows.map((row, rowIndex) => (
                      <div key={`tech-row-${rowIndex}`} style={{ display: 'grid', gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`, gap: '10px' }}>
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
                                borderRadius: '14px',
                                border: `1px solid ${borderColor}`,
                                background: bgColor,
                                color: status === 'locked' ? '#64748b' : '#e2e8f0',
                                padding: '11px 10px',
                                textAlign: 'left'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', textTransform: 'uppercase' }}>
                                <span>{option.icon} {option.label}</span>
                                <span>{statusLabel}</span>
                              </div>
                              <div style={{ marginTop: '6px', fontSize: '10px', color: status === 'locked' ? '#475569' : '#93c5fd', lineHeight: 1.45 }}>
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
                  <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
                    {unlockSummary.map((entry) => {
                      const online = !!(stats.buildState || {})[entry.building];
                      return (
                        <div
                          key={`summary-${entry.building}`}
                          style={{
                            borderRadius: '12px',
                            border: `1px solid ${online ? 'rgba(74,222,128,0.35)' : 'rgba(148,163,184,0.16)'}`,
                            background: online ? 'rgba(21,128,61,0.16)' : 'rgba(15,23,42,0.34)',
                            padding: '9px 10px'
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
                </>
              )}
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
            {buildPanelMode === 'structures' && (
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
            )}
            {buildPanelMode === 'upgrades' && (
            <div style={{ marginTop: '2px', display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }}>
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
            )}
            </>
          )}

          {activePanel === 'threat' && (
            <div style={{ maxHeight: 'none', overflowY: 'visible' }}>
            {activeKaijus.length === 0 && (
              <div style={{ fontSize: '10px', color: '#fca5a5', opacity: 0.8 }}>No active kaiju.</div>
            )}
            {activeKaijus.map((k, i) => (
              <div key={i} style={{ marginBottom: '7px' }}>
                {(() => {
                  const elementMeta = getElementMeta(k.element);
                  const weakMeta = getElementMeta(k.weakAgainst);
                  const resistMeta = k.resistAgainst ? getElementMeta(k.resistAgainst) : null;
                  const recentElementHit = k.lastElementHitAt && Date.now() - k.lastElementHitAt < 1800;
                  return (
                    <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#fca5a5' }}>
                  <span>👹 {k.displayName || getKaijuDisplayName(k.variant)}</span>
                  <span>{`${Math.round(Math.max(0, k.hp))}/${k.maxHp}`}</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '3px', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  <span style={{ color: elementMeta.color }}>Type {elementMeta.shortLabel}</span>
                  <span style={{ color: weakMeta.color }}>Weak {weakMeta.shortLabel}</span>
                  {resistMeta && <span style={{ color: '#fda4af' }}>Resist {resistMeta.shortLabel}</span>}
                  {recentElementHit && k.lastElementState === 'advantage' && <span style={{ color: '#86efac' }}>Bonus Hit</span>}
                  {recentElementHit && k.lastElementState === 'resist' && <span style={{ color: '#fca5a5' }}>Resisted</span>}
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
                    </>
                  );
                })()}
              </div>
            ))}
            </div>
          )}
        </div>
        </div>
        </div>
        <button
          onClick={() => setLeftPanelCollapsed(v => !v)}
          style={{
            flexShrink: 0,
            pointerEvents: 'auto',
            alignSelf: 'center',
            width: '22px',
            padding: '20px 0',
            borderRadius: '0 8px 8px 0',
            border: '1px solid rgba(34,197,94,0.4)',
            borderLeft: 'none',
            background: 'rgba(3,7,18,0.90)',
            color: '#4ade80',
            fontSize: '9px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            writingMode: 'vertical-rl',
            letterSpacing: '0.14em',
            textTransform: 'uppercase'
          }}
        >
          {leftPanelCollapsed ? '▶' : '◀'}
        </button>
      </div>

      {selectedProductionBuilding && (
        <div
          className="absolute inset-0 z-40 flex items-end justify-center pointer-events-none select-none sm:items-center"
          style={{ fontFamily: "'Courier New', monospace" }}
        >
          <div
            style={{
              width: 'min(92vw, 500px)',
              marginBottom: '18px',
              borderRadius: '22px',
              border: '1px solid rgba(74,222,128,0.32)',
              background: 'linear-gradient(180deg, rgba(2,6,23,0.96), rgba(7,18,27,0.94))',
              boxShadow: '0 20px 50px rgba(2,8,23,0.38), 0 0 40px rgba(16,185,129,0.12)',
              padding: '18px',
              pointerEvents: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '10px', color: '#86efac', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                  Production Building
                </div>
                <div style={{ marginTop: '6px', fontSize: '22px', color: '#ecfdf5', textTransform: 'uppercase' }}>
                  {selectedProductionBuilding.icon} {selectedProductionBuilding.label}
                </div>
                <div style={{ marginTop: '6px', fontSize: '10px', color: '#a7f3d0', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  {(selectedProductionBuilding.units || []).length > 0 ? 'Queue units or trigger the structure command' : 'Trigger the structure command'}
                </div>
              </div>
              <button
                onClick={handleProductionModalClose}
                style={{
                  borderRadius: '12px',
                  border: '1px solid rgba(148,163,184,0.25)',
                  background: 'rgba(15,23,42,0.55)',
                  color: '#cbd5e1',
                  padding: '8px 12px',
                  fontSize: '11px',
                  textTransform: 'uppercase'
                }}
              >
                Close
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px', marginTop: '14px', marginBottom: '14px' }}>
              {[
                { icon: '🪖', label: 'Inf', value: stats.soldiers },
                { icon: '🚜', label: 'Armor', value: stats.tanks },
                { icon: '✈️', label: 'Air', value: stats.jets }
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    borderRadius: '12px',
                    border: '1px solid rgba(148,163,184,0.16)',
                    background: 'rgba(15,23,42,0.42)',
                    padding: '8px 10px'
                  }}
                >
                  <div style={{ fontSize: '8px', color: '#94a3b8', letterSpacing: '0.14em', textTransform: 'uppercase' }}>{item.label}</div>
                  <div style={{ marginTop: '2px', fontSize: '11px', color: '#e2e8f0' }}>{item.icon} {item.value}</div>
                </div>
              ))}
            </div>

            {selectedBuildingAction && (
              <div
                style={{
                  marginBottom: '14px',
                  borderRadius: '16px',
                  border: '1px solid rgba(34,211,238,0.22)',
                  background: 'linear-gradient(180deg, rgba(6,78,59,0.18), rgba(8,47,73,0.18))',
                  padding: '12px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '8px', color: '#67e8f9', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                      {selectedBuildingAction.tag} ability
                    </div>
                    <div style={{ marginTop: '4px', fontSize: '15px', color: '#ecfeff', textTransform: 'uppercase' }}>
                      {selectedBuildingAction.label}
                    </div>
                    <div style={{ marginTop: '4px', fontSize: '10px', color: '#bfdbfe', lineHeight: 1.45 }}>
                      {selectedBuildingAction.description}
                    </div>
                  </div>
                  <button
                    onClick={handleFacilityActionClick}
                    disabled={!selectedBuildingAction.ready || stats.credits < selectedBuildingAction.cost}
                    style={{
                      minWidth: '118px',
                      borderRadius: '14px',
                      border: '1px solid rgba(34,211,238,0.3)',
                      background: !selectedBuildingAction.ready || stats.credits < selectedBuildingAction.cost ? 'rgba(255,255,255,0.04)' : 'rgba(8,145,178,0.22)',
                      color: !selectedBuildingAction.ready || stats.credits < selectedBuildingAction.cost ? '#64748b' : '#cffafe',
                      padding: '12px 10px',
                      fontSize: '11px',
                      textTransform: 'uppercase'
                    }}
                  >
                    {!selectedBuildingAction.ready ? `${Math.ceil(selectedBuildingAction.cooldownRemaining / 1000)}s` : `$${selectedBuildingAction.cost}`}
                  </button>
                </div>
                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#94a3b8', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  <span>{selectedBuildingAction.activeRemaining > 0 ? `Active ${Math.ceil(selectedBuildingAction.activeRemaining / 1000)}s` : 'Standby'}</span>
                  <span>{selectedBuildingAction.ready ? 'Ready' : 'Cooldown'}</span>
                </div>
              </div>
            )}

            {(selectedProductionBuilding.trainingUnitType || productionQueue.length > 0) && (
              <div
                style={{
                  marginBottom: '14px',
                  borderRadius: '14px',
                  border: '1px solid rgba(125,211,252,0.22)',
                  background: 'rgba(8,47,73,0.24)',
                  padding: '10px 12px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#bae6fd', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                  <span>Training</span>
                  <span>{selectedProductionBuilding.trainingUnitType ? (DEPLOY_OPTIONS[selectedProductionBuilding.trainingUnitType]?.label || selectedProductionBuilding.trainingUnitType) : 'Queue Idle'}</span>
                </div>
                {selectedProductionBuilding.trainingUnitType && (
                  <div style={{ marginTop: '6px', height: '5px', background: 'rgba(15,23,42,0.65)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.round((selectedProductionBuilding.trainingProgress || 0) * 100)}%`,
                        background: 'linear-gradient(90deg, #22d3ee, #86efac)'
                      }}
                    />
                  </div>
                )}
                <div style={{ marginTop: '6px', fontSize: '8px', color: '#bfdbfe', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  Queue {productionQueue.length}
                </div>
              </div>
            )}

            {(visibleDeployPanelOptions.length > 0 || !selectedBuildingAction) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {visibleDeployPanelOptions.map(([key, option]) => {
                const isUnlocked = (stats.deployUnlocks || {})[key] !== false;
                const blocked = !isUnlocked || stats.credits < option.cost || aliveBunkerCount <= 0 || !hasBattlefieldPressure || !!pendingBuildOption;
                const queued = queueCounts[key] || 0;
                const manualPlace = !isQueuedDeployUnit(key);
                const selected = pendingDeploy === key;
                return (
                  <button
                    key={key}
                    onClick={() => handleDeployClick(key)}
                    disabled={blocked}
                    style={{
                      borderRadius: '14px',
                      border: selected ? '1px solid rgba(110,231,183,0.9)' : '1px solid rgba(74,222,128,0.28)',
                      background: blocked ? 'rgba(255,255,255,0.04)' : selected ? 'rgba(6,95,70,0.45)' : 'rgba(21,128,61,0.14)',
                      color: blocked ? '#64748b' : selected ? '#ecfdf5' : '#dcfce7',
                      padding: '12px 10px',
                      fontSize: '11px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      textTransform: 'uppercase'
                    }}
                  >
                    <span>{option.icon} {option.label}</span>
                    <span>{!isUnlocked ? 'LOCK' : manualPlace ? (selected ? 'READY' : `$${option.cost}`) : queued > 0 ? `Q${queued}` : `$${option.cost}`}</span>
                  </button>
                );
              })}
              {!visibleDeployPanelOptions.length && (
                <div style={{ gridColumn: '1 / -1', borderRadius: '10px', border: '1px dashed rgba(148,163,184,0.22)', padding: '10px 8px', fontSize: '9px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                  This building has no deploy units.
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

const SettingsMenu = ({ resolutionPreset, setResolutionPreset, fpsCap, setFpsCap }) => {
  const [open, setOpen] = useState(false);
  const currentPreset = RESOLUTION_PRESETS[resolutionPreset] || RESOLUTION_PRESETS[DEFAULT_RESOLUTION_PRESET];
  const currentFpsCap = FPS_CAP_OPTIONS[fpsCap] || FPS_CAP_OPTIONS[DEFAULT_FPS_CAP];

  return (
    <div
      className="fallout-ui-area absolute right-4 bottom-24 z-50 pointer-events-auto select-none sm:right-6 sm:bottom-28"
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
          <div className="mb-2 text-[10px] font-bold tracking-[0.24em] text-cyan-300 uppercase">
            Frame Cap
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {Object.entries(FPS_CAP_OPTIONS).map(([key, option]) => {
              const active = key === fpsCap;
              return (
                <button
                  key={key}
                  onClick={() => setFpsCap(key)}
                  className={`rounded-xl border px-2 py-2 text-left transition-all ${
                    active
                      ? 'border-cyan-300/55 bg-cyan-500/18 text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.16)]'
                      : 'border-white/10 bg-white/5 text-slate-200 hover:border-cyan-500/20 hover:bg-cyan-500/8'
                  }`}
                >
                  <div className="text-[10px] font-bold tracking-[0.08em] uppercase">{option.label}</div>
                </button>
              );
            })}
          </div>
          <div className="mb-3 text-[10px] text-cyan-400/70">
            Frame cap: {currentFpsCap.note}
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
          <div className="mt-1 text-[9px] tracking-[0.18em] text-cyan-300/80 uppercase">{currentFpsCap.label}</div>
        </div>
        <div className="ml-4 rounded-full border border-green-400/30 bg-green-500/10 px-2 py-1 text-[10px] font-bold tracking-[0.16em] uppercase">
          {open ? 'Close' : 'Open'}
        </div>
      </button>
    </div>
  );
};

const FrameRateController = ({ fpsCap }) => {
  const { invalidate, setFrameloop } = useThree();

  useEffect(() => {
    const option = FPS_CAP_OPTIONS[fpsCap] || FPS_CAP_OPTIONS[DEFAULT_FPS_CAP];
    if (!option || option.frameMs <= 0) {
      setFrameloop('always');
      return undefined;
    }

    setFrameloop('demand');
    invalidate();
    const interval = window.setInterval(() => {
      invalidate();
    }, Math.max(16, Math.round(option.frameMs)));

    return () => {
      window.clearInterval(interval);
      setFrameloop('always');
    };
  }, [fpsCap, invalidate, setFrameloop]);

  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// BOMB CAM HUD — infrared/FLIR seeker overlay shown while the guided nuke is
// falling. Appears over the bomb-follow camera so the player can actually see
// what is happening, with targeting reticle, altitude, and impact countdown.
// ─────────────────────────────────────────────────────────────────────────────
const BombCamHUD = () => {
  const [phase, setPhase] = useState('entering'); // 'entering' | 'active' | 'exiting' | 'hidden'
  const phaseRef = useRef('entering');
  const [hudData, setHudData] = useState({ alt: 300, velocity: 45, targetX: 0, targetZ: 0, impactIn: 8, agl: 300 });
  const [blinkOn, setBlinkOn] = useState(true);
  const [imminent, setImminent] = useState(false);
  const rafRef = useRef(null);
  const exitTimerRef = useRef(null);

  const setPhaseSync = useCallback((p) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  // Animate HUD readouts with RAF, update state at ~10fps to save CPU
  useEffect(() => {
    let lastUpdate = 0;
    const animate = (t) => {
      if (t - lastUpdate > 100) {
        lastUpdate = t;
        const alt = window._falloutBombCamAlt ?? 300;
        const velocity = window._falloutBombCamVelocity ?? 45;
        const targetX = window._falloutBombCamTargetX ?? 0;
        const targetZ = window._falloutBombCamTargetZ ?? 0;
        const targetAlt = window._falloutBombCamTargetAlt ?? 0;
        const agl = Math.max(0, alt - targetAlt);
        // Estimate time-to-impact from AGL and current fall speed
        const fallSpeed = Math.max(4, Math.abs(window._falloutBombCamVelocity ?? 4));
        const impactSec = Math.max(0, agl / Math.max(4, fallSpeed));
        const isImminent = agl < 80 || impactSec < 3.5;
        setHudData({
          alt: Math.round(alt),
          velocity: Math.round(velocity),
          targetX: Math.round(targetX),
          targetZ: Math.round(targetZ),
          impactIn: impactSec.toFixed(1),
          agl: Math.round(agl),
        });
        setImminent(isImminent);
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Blink ticker for IMPACT IMMINENT alert
  useEffect(() => {
    const id = setInterval(() => setBlinkOn(b => !b), 420);
    return () => clearInterval(id);
  }, []);

  // Poll to handle entry / exit transitions
  useEffect(() => {
    const id = setInterval(() => {
      const active = !!window._falloutBombCamActive;
      const cur = phaseRef.current;
      if (active && cur === 'entering') {
        setPhaseSync('active');
      } else if (!active && (cur === 'active' || cur === 'entering')) {
        clearTimeout(exitTimerRef.current);
        setPhaseSync('exiting');
        exitTimerRef.current = setTimeout(() => setPhaseSync('hidden'), 420);
      }
    }, 100);
    return () => { clearInterval(id); clearTimeout(exitTimerRef.current); };
  }, [setPhaseSync]);

  if (phase === 'hidden') return null;

  const exiting = phase === 'exiting';

  const hudStyle = {
    position: 'absolute', inset: 0, zIndex: 44,
    background: 'rgba(4,2,0,0.28)',
    fontFamily: "'Courier New', Courier, monospace",
    color: 'rgba(255,185,55,0.95)',
    overflow: 'hidden',
    userSelect: 'none',
    pointerEvents: 'none',
    animation: exiting
      ? 'fallout-hud-slide-out 0.38s ease-in forwards'
      : 'fallout-hud-slide-in 0.42s ease-out forwards',
  };

  const amber = { textShadow: '0 0 7px rgba(255,150,15,0.65)' };

  const boxLabel = {
    display: 'inline-block',
    border: '1.5px solid rgba(255,185,55,0.75)',
    padding: '0 6px',
    minWidth: '5.2em',
    textAlign: 'center',
    background: 'rgba(18,8,0,0.62)',
    letterSpacing: '0.04em',
    fontSize: '1.1vw',
    lineHeight: '1.65',
  };

  return (
    <div style={hudStyle}>

      {/* ── CRT scanlines ── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 12,
        background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)',
      }} />

      {/* ── Thermal vignette ── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11,
        background: 'radial-gradient(ellipse at center, transparent 32%, rgba(0,3,8,0.70) 100%)',
      }} />

      {/* ── Subtle center warm glow ── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10,
        background: 'radial-gradient(ellipse at 50% 52%, rgba(255,130,0,0.05) 0%, transparent 55%)',
      }} />

      {/* ── Moving scan line ── */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: '2px', pointerEvents: 'none', zIndex: 9,
        background: 'linear-gradient(90deg, transparent, rgba(255,160,20,0.18), transparent)',
        animation: 'fallout-hud-scanline 4s linear infinite',
      }} />

      {/* ── TOP-CENTER: mode label ── */}
      <div style={{
        position: 'absolute', top: '4.5%', left: '50%', transform: 'translateX(-50%)',
        textAlign: 'center', pointerEvents: 'none', zIndex: 20, ...amber,
      }}>
        <div style={{ fontSize: '1.0vw', letterSpacing: '0.35em', opacity: 0.85 }}>IR SEEKER</div>
        <div style={{ fontSize: '0.72vw', letterSpacing: '0.22em', opacity: 0.5, marginTop: '2px' }}>GUIDED MUNITION ☢</div>
      </div>

      {/* ── TOP-LEFT: altitude readouts ── */}
      <div style={{
        position: 'absolute', top: '5%', left: '6%',
        fontSize: '1.0vw', lineHeight: '1.9', pointerEvents: 'none', ...amber,
      }}>
        <div style={{ fontSize: '0.72vw', opacity: 0.52, letterSpacing: '0.22em' }}>ALTITUDE</div>
        <div style={boxLabel}>{hudData.alt} M</div>
        <div style={{ marginTop: '7px', fontSize: '0.72vw', opacity: 0.52, letterSpacing: '0.22em' }}>AGL</div>
        <div style={boxLabel}>{hudData.agl} M</div>
        {/* Dotted scale bar */}
        <div style={{
          position: 'absolute', right: '-6px', top: '0', bottom: '0', width: '2px',
          background: 'repeating-linear-gradient(180deg, rgba(255,185,55,0.5) 0 3px, transparent 3px 7px)',
        }} />
      </div>

      {/* ── TOP-RIGHT: velocity & target coords ── */}
      <div style={{
        position: 'absolute', top: '5%', right: '6%',
        fontSize: '1.0vw', lineHeight: '1.9', pointerEvents: 'none', textAlign: 'right', ...amber,
      }}>
        <div style={{ fontSize: '0.72vw', opacity: 0.52, letterSpacing: '0.22em' }}>VELOCITY</div>
        <div style={boxLabel}>{hudData.velocity} M/S</div>
        <div style={{ marginTop: '7px', fontSize: '0.72vw', opacity: 0.52, letterSpacing: '0.22em' }}>TARGET COORD</div>
        <div style={{ ...boxLabel, fontSize: '0.88vw' }}>{hudData.targetX} / {hudData.targetZ}</div>
        {/* Dotted scale bar */}
        <div style={{
          position: 'absolute', left: '-6px', top: '0', bottom: '0', width: '2px',
          background: 'repeating-linear-gradient(180deg, rgba(255,185,55,0.5) 0 3px, transparent 3px 7px)',
        }} />
      </div>

      {/* ── CENTER: IR targeting reticle ── */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none', zIndex: 20,
        width: 0, height: 0,
      }}>
        {/* Outer targeting box */}
        <div style={{
          position: 'absolute',
          width: '7.8vw', height: '7.8vw',
          transform: 'translate(-50%, -50%)',
          border: `2px solid rgba(255,185,55,${imminent ? 0.98 : 0.80})`,
          boxShadow: `0 0 ${imminent ? '28px' : '14px'} rgba(255,130,0,${imminent ? 0.65 : 0.32})`,
        }}>
          {/* L-shape corner accents */}
          {[
            { top: -2, left: -2, borderTop: '2px solid', borderLeft: '2px solid' },
            { top: -2, right: -2, borderTop: '2px solid', borderRight: '2px solid' },
            { bottom: -2, left: -2, borderBottom: '2px solid', borderLeft: '2px solid' },
            { bottom: -2, right: -2, borderBottom: '2px solid', borderRight: '2px solid' },
          ].map((s, i) => (
            <div key={i} style={{
              position: 'absolute', width: '20%', height: '20%',
              borderColor: 'rgba(255,215,95,0.95)', ...s,
            }} />
          ))}
        </div>
        {/* Inner dashed ring */}
        <div style={{
          position: 'absolute',
          width: '4.8vw', height: '4.8vw',
          transform: 'translate(-50%, -50%)',
          border: '1px dashed rgba(255,185,55,0.32)',
          borderRadius: '50%',
        }} />
        {/* Center diamond */}
        <div style={{
          position: 'absolute',
          width: '10px', height: '10px',
          transform: 'translate(-50%, -50%) rotate(45deg)',
          border: '1.5px solid rgba(255,215,80,0.95)',
          boxShadow: '0 0 9px rgba(255,150,0,0.8)',
        }} />
        {/* Crosshair stubs */}
        {[
          { top: '50%', left: '-3.0vw', width: '1.7vw', height: '1.5px', transform: 'translateY(-50%)' },
          { top: '50%', right: '-3.0vw', width: '1.7vw', height: '1.5px', transform: 'translateY(-50%)' },
          { left: '50%', top: '-3.0vw', width: '1.5px', height: '1.7vw', transform: 'translateX(-50%)' },
          { left: '50%', bottom: '-3.0vw', width: '1.5px', height: '1.7vw', transform: 'translateX(-50%)' },
        ].map((s, i) => (
          <div key={i} style={{ position: 'absolute', background: 'rgba(255,185,55,0.72)', ...s }} />
        ))}
        {/* Range label beneath reticle */}
        <div style={{
          position: 'absolute', bottom: '-5.5vw', left: '50%', transform: 'translateX(-50%)',
          fontSize: '0.78vw', whiteSpace: 'nowrap', opacity: 0.72, ...amber,
        }}>
          {hudData.agl} M AGL
        </div>
      </div>

      {/* ── BOTTOM-CENTER: impact countdown ── */}
      <div style={{
        position: 'absolute', bottom: '9.5%', left: '50%', transform: 'translateX(-50%)',
        textAlign: 'center', pointerEvents: 'none', zIndex: 20, ...amber,
      }}>
        {imminent ? (
          <div style={{
            fontSize: '1.3vw', letterSpacing: '0.28em', fontWeight: 'bold',
            color: 'rgba(255,75,55,0.98)',
            textShadow: '0 0 14px rgba(255,50,10,0.85)',
            opacity: blinkOn ? 1 : 0.15,
          }}>
            ▼  IMPACT IMMINENT  ▼
          </div>
        ) : (
          <div style={{ fontSize: '1.1vw', letterSpacing: '0.22em', opacity: 0.9 }}>
            IMPACT IN&nbsp;&nbsp;<span style={boxLabel}>{hudData.impactIn} S</span>
          </div>
        )}
      </div>

      {/* ── BOTTOM-LEFT: system status ── */}
      <div style={{
        position: 'absolute', bottom: '8%', left: '6%',
        fontSize: '0.88vw', lineHeight: '2.0', pointerEvents: 'none', ...amber, opacity: 0.65,
      }}>
        <div>GUIDE MODE</div>
        <div>NUKE ☢</div>
        <div>GPS LOCK</div>
      </div>

      {/* ── BOTTOM-RIGHT: weapon status ── */}
      <div style={{
        position: 'absolute', bottom: '8%', right: '6%',
        fontSize: '0.88vw', lineHeight: '2.0', pointerEvents: 'none', textAlign: 'right', ...amber, opacity: 0.65,
      }}>
        <div>SEEKER ON</div>
        <div>FINS ARMED</div>
        <div>WPN HOT</div>
      </div>

    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PILOT HUD — shown when the Nuke is armed so the player can aim and pickle
// the bomb themselves like a real weapons officer.
// ─────────────────────────────────────────────────────────────────────────────
const NukePilotHUD = () => {
  // 'hidden' | 'active' | 'exiting'
  // phaseRef mirrors phase so interval/timeout closures always read the current value
  // without requiring re-registration of intervals (which caused the one-shot bug).
  const [phase, setPhase] = useState('hidden');
  const phaseRef = useRef('hidden');
  const [blinkOn, setBlinkOn] = useState(true);
  const [hudVals, setHudVals] = useState({ speed: 465, alt: 4430, heading: 25, range: 2200, aoa: 1.7 });
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 }); // percent
  const timeRef = useRef(0);
  const rafRef = useRef(null);
  const exitTimerRef = useRef(null);

  const setPhaseSync = useCallback((p) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const doExit = useCallback(() => {
    if (phaseRef.current === 'hidden' || phaseRef.current === 'exiting') return;
    clearTimeout(exitTimerRef.current);
    setPhaseSync('exiting');
    exitTimerRef.current = setTimeout(() => setPhaseSync('hidden'), 380);
  }, [setPhaseSync]);

  // Animate HUD readouts with RAF, update state at ~10fps to save CPU
  useEffect(() => {
    if (phase === 'hidden') return;
    let lastUpdate = 0;
    const animate = (t) => {
      timeRef.current = t * 0.001;
      if (t - lastUpdate > 100) {
        lastUpdate = t;
        const s = timeRef.current;
        setHudVals({
          speed:   465 + Math.sin(s * 0.7) * 4,
          alt:     4430 + Math.sin(s * 0.5) * 14,
          heading: 25 + Math.sin(s * 0.3) * 2,
          range:   Math.max(600, 2200 - s * 12 + Math.sin(s * 0.4) * 80),
          aoa:     1.7 + Math.sin(s * 0.9) * 0.08,
        });
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase === 'hidden']);

  // Blink ticker for PICKLE indicator
  useEffect(() => {
    if (phase === 'hidden') return;
    const id = setInterval(() => setBlinkOn(b => !b), 480);
    return () => clearInterval(id);
  }, [phase === 'hidden']);

  // Poll window._falloutManualStrikeArmed — registered ONCE, uses phaseRef for fresh reads
  useEffect(() => {
    const id = setInterval(() => {
      const armed = !!window._falloutManualStrikeArmed;
      const cur = phaseRef.current;
      if (armed && cur === 'hidden') {
        // Nuke armed — show HUD
        clearTimeout(exitTimerRef.current);
        setPhaseSync('active');
      } else if (!armed && (cur === 'active')) {
        // Armed cleared externally (e.g. cancelled) — exit
        doExit();
      }
    }, 80);
    return () => { clearInterval(id); clearTimeout(exitTimerRef.current); };
  }, [setPhaseSync, doExit]);

  const handleMouseMove = useCallback((e) => {
    setMousePos({
      x: (e.clientX / window.innerWidth) * 100,
      y: (e.clientY / window.innerHeight) * 100,
    });
  }, []);

  const handlePickle = useCallback((e) => {
    if (phaseRef.current !== 'active') return;
    e.stopPropagation();
    doExit();
    // Dispatch to VillageScene for world-coord mapping & strike launch
    window.dispatchEvent(new CustomEvent('fallout-pilot-release', {
      detail: { clientX: e.clientX, clientY: e.clientY }
    }));
  }, [doExit]);

  if (phase === 'hidden') return null;

  const exiting = phase === 'exiting';
  const { speed, alt, heading, range, aoa } = hudVals;
  const pitch = Math.sin(timeRef.current * 0.6) * 1.5;
  const bank  = Math.sin(timeRef.current * 0.4) * 2.5;

  const hudStyle = {
    position: 'absolute', inset: 0, zIndex: 45,
    background: `radial-gradient(ellipse 38vw 30vw at ${mousePos.x}% ${mousePos.y}%, rgba(0,8,2,0.00) 0%, rgba(0,8,2,0.18) 45%, rgba(0,6,2,0.52) 100%)`,
    backdropFilter: 'brightness(1.15) saturate(0.28) hue-rotate(88deg)',
    cursor: 'crosshair',
    fontFamily: "'Courier New', Courier, monospace",
    color: 'rgba(188,255,188,0.92)',
    overflow: 'hidden',
    userSelect: 'none',
    animation: exiting ? 'fallout-hud-slide-out 0.35s ease-in forwards' : 'fallout-hud-slide-in 0.4s ease-out forwards',
  };
  const phosphor = { textShadow: '0 0 6px rgba(0,255,80,0.6)' };
  const boxLabel = {
    display: 'inline-block',
    border: '1.5px solid rgba(188,255,188,0.85)',
    padding: '0 5px',
    minWidth: '4.5em',
    textAlign: 'center',
    background: 'rgba(0,18,4,0.55)',
    letterSpacing: '0.04em',
    fontSize: '1.25vw',
    lineHeight: '1.5',
  };

  return (
    <div style={hudStyle} onMouseMove={handleMouseMove} onClick={handlePickle}>

      {/* ── CRT scan-lines ── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 12,
        background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.07) 3px, rgba(0,0,0,0.07) 4px)',
      }} />
      {/* Phosphor vignette */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11,
        background: 'radial-gradient(ellipse at center, transparent 52%, rgba(0,8,2,0.38) 100%)',
      }} />
      {/* ── Scene illuminate at cursor — reveals the target underneath ── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 13,
        background: `radial-gradient(ellipse 28vw 22vw at ${mousePos.x}% ${mousePos.y}%, rgba(180,255,160,0.22) 0%, rgba(80,220,80,0.08) 55%, transparent 100%)`,
        mixBlendMode: 'screen',
      }} />

      {/* ── HEADING TAPE (top center) ── */}
      <div style={{ position: 'absolute', top: '5.5%', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', pointerEvents: 'none', ...phosphor }}>
        <div style={{ display: 'flex', gap: '2.2vw', alignItems: 'flex-end', justifyContent: 'center', fontSize: '1.1vw' }}>
          {[-2,-1,0,1,2].map(offset => {
            const h = Math.round(heading + offset * 5);
            const disp = ((h % 36) + 36) % 36;
            return (
              <span key={offset} style={{ opacity: offset === 0 ? 1 : 0.45 - Math.abs(offset)*0.05 }}>
                {String(disp).padStart(2,'0')}
              </span>
            );
          })}
        </div>
        <div style={{ textAlign: 'center', fontSize: '0.9vw', marginTop: '1px', opacity: 0.7 }}>▼</div>
      </div>

      {/* ── TOP-LEFT LABELS ── */}
      <div style={{ position: 'absolute', top: '4%', left: '5%', fontSize: '1.0vw', lineHeight: '1.7', pointerEvents: 'none', ...phosphor }}>
        <div style={{ opacity: 0.75 }}>CCIP</div>
        <div style={{ opacity: 0.6, fontSize: '0.85vw' }}>NUKE ☢</div>
      </div>
      {/* "TERY" label like the reference image */}
      <div style={{ position: 'absolute', top: '3%', right: '5%', fontSize: '0.9vw', opacity: 0.5, pointerEvents: 'none', ...phosphor }}>
        WPNS SYS
      </div>

      {/* ── MAIN HUD CIRCLE ── */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: '60vmin', height: '60vmin',
        transform: 'translate(-50%, -50%)',
        border: '1px solid rgba(188,255,188,0.45)',
        borderRadius: '50%',
        pointerEvents: 'none',
        boxShadow: '0 0 40px rgba(0,255,80,0.06), inset 0 0 30px rgba(0,255,80,0.03)',
      }} />
      {/* Inner tick ring */}
      {Array.from({ length: 36 }, (_, i) => {
        const angle = (i / 36) * 360;
        const isMajor = i % 9 === 0;
        const len = isMajor ? '3%' : '1.5%';
        const r = 30; // vmin radius
        const rad = (angle - 90) * Math.PI / 180;
        const x = 50 + r * Math.cos(rad);
        const y = 50 + r * Math.sin(rad);
        return (
          <div key={i} style={{
            position: 'absolute',
            left: `${x}%`, top: `${y}%`,
            width: isMajor ? '0.8%' : '0.4%', height: isMajor ? '1.5%' : '0.8%',
            background: `rgba(188,255,188,${isMajor ? 0.5 : 0.22})`,
            transform: `translate(-50%,-50%) rotate(${angle}deg)`,
            pointerEvents: 'none',
          }} />
        );
      })}

      {/* ── PITCH LADDER ── */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: `translate(-50%, -50%) rotate(${bank}deg)`,
        width: '100%', height: '100%', pointerEvents: 'none',
      }}>
        {[-20, -10, 0, 10, 20].map(deg => {
          const yOff = (deg - pitch) * 0.95; // vw offset per degree
          const isZero = deg === 0;
          const w = isZero ? '26vw' : '14vw';
          const op = 1 - Math.abs(deg) * 0.022;
          return (
            <div key={deg} style={{
              position: 'absolute', left: '50%', top: '50%',
              transform: `translate(-50%, calc(-50% + ${yOff}vw))`,
              width: w, height: '1.5px',
              background: `rgba(188,255,188,${op * 0.75})`,
              display: 'flex', alignItems: 'center',
            }}>
              {!isZero && (
                <>
                  <span style={{ position: 'absolute', left: '-2.4vw', fontSize: '0.85vw', opacity: 0.6, ...phosphor }}>{Math.abs(deg)}</span>
                  <span style={{ position: 'absolute', right: '-2.4vw', fontSize: '0.85vw', opacity: 0.6, ...phosphor }}>{Math.abs(deg)}</span>
                </>
              )}
            </div>
          );
        })}
        {/* Aircraft reference symbol */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
          {/* Wings */}
          <div style={{ position: 'absolute', top: '-1px', left: '-3.2vw', width: '2.2vw', height: '2px', background: 'rgba(188,255,188,0.9)' }} />
          <div style={{ position: 'absolute', top: '-1px', right: '-3.2vw', width: '2.2vw', height: '2px', background: 'rgba(188,255,188,0.9)' }} />
          {/* Center dot */}
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'rgba(188,255,188,0.9)', transform: 'translate(-50%,-50%)', position: 'absolute' }} />
        </div>
      </div>

      {/* ── SPEED TAPE (left) ── */}
      <div style={{
        position: 'absolute', left: '7.5%', top: '50%', transform: 'translateY(-50%)',
        textAlign: 'right', fontSize: '1.0vw', lineHeight: '2.3', pointerEvents: 'none', ...phosphor,
      }}>
        {[50,45,40,35].map(v => <div key={v} style={{ opacity: 0.5 }}>{v}─</div>)}
        <div style={{ ...boxLabel, marginBottom: '4px' }}>{Math.round(speed)}</div>
        <div style={{ opacity: 0.45, fontSize: '0.9vw', marginTop: '3px' }}>C</div>
        <div style={{ marginTop: '6px', opacity: 0.55, fontSize: '0.85vw' }}>SIM<br/>{aoa.toFixed(2)}</div>
        {/* Dotted scale bar */}
        <div style={{
          position: 'absolute', right: '-6px', top: '0', bottom: '0', width: '2px',
          background: 'repeating-linear-gradient(180deg, rgba(188,255,188,0.55) 0 3px, transparent 3px 7px)',
        }} />
      </div>

      {/* ── ALTITUDE TAPE (right) ── */}
      <div style={{
        position: 'absolute', right: '7.5%', top: '50%', transform: 'translateY(-50%)',
        textAlign: 'left', fontSize: '1.0vw', lineHeight: '2.3', pointerEvents: 'none', ...phosphor,
      }}>
        {['05.0','04.5','04.0'].map(v => <div key={v} style={{ opacity: 0.5, paddingLeft: '4px' }}>─{v}</div>)}
        <div style={{ ...boxLabel, marginBottom: '4px' }}>{Math.round(alt).toLocaleString()}</div>
        {/* Dotted scale bar */}
        <div style={{
          position: 'absolute', left: '-6px', top: '0', bottom: '0', width: '2px',
          background: 'repeating-linear-gradient(180deg, rgba(188,255,188,0.55) 0 3px, transparent 3px 7px)',
        }} />
      </div>

      {/* ── INFO BLOCK bottom-left ── */}
      <div style={{
        position: 'absolute', bottom: '11%', left: '7.5%',
        fontSize: '1.0vw', lineHeight: '1.9', pointerEvents: 'none', ...phosphor,
      }}>
        <div>ARM</div>
        <div>0.76</div>
        <div style={{ marginTop: '3px' }}>4.6</div>
        <div>CCIP</div>
        <div>α {aoa.toFixed(1)}</div>
      </div>

      {/* ── INFO BLOCK bottom-right ── */}
      <div style={{
        position: 'absolute', bottom: '11%', right: '7.5%',
        fontSize: '1.0vw', lineHeight: '1.9', pointerEvents: 'none', textAlign: 'right', ...phosphor,
      }}>
        <div>R <span style={boxLabel}>{Math.round(range).toLocaleString()}</span></div>
        <div>AL 1000</div>
        <div>F 050</div>
        <div>{new Date().toLocaleDateString('en-US',{year:'2-digit',month:'2-digit',day:'2-digit'}).replace(/\//g,'')}</div>
        <div>001&gt;010</div>
        <div>SYS1 GPS1</div>
      </div>

      {/* ── CCIP PIPPER (mouse-tracking targeting circle) ── */}
      <div style={{
        position: 'absolute',
        left: `${mousePos.x}%`, top: `${mousePos.y}%`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none', zIndex: 20,
      }}>
        {/* Wide outer scan ring */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          width: '11vw', height: '11vw',
          transform: 'translate(-50%, -50%)',
          border: '1px solid rgba(188,255,188,0.25)',
          borderRadius: '50%',
          boxShadow: '0 0 28px rgba(0,255,80,0.12)',
        }} />
        {/* Mid targeting ring */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          width: '6.2vw', height: '6.2vw',
          transform: 'translate(-50%, -50%)',
          border: '1px dashed rgba(188,255,188,0.35)',
          borderRadius: '50%',
        }} />
        {/* Main targeting circle */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          width: '4.2vw', height: '4.2vw',
          transform: 'translate(-50%, -50%)',
          border: '2.5px solid rgba(210,255,210,0.98)',
          borderRadius: '50%',
          boxShadow: '0 0 28px rgba(0,255,80,0.80), 0 0 10px rgba(0,255,80,0.5) inset',
        }} />
        {/* Center dot */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          width: '8px', height: '8px',
          background: 'rgba(220,255,220,0.98)',
          borderRadius: '50%',
          transform: 'translate(-50%,-50%)',
          boxShadow: '0 0 12px rgba(0,255,80,0.95)',
        }} />
        {/* Crosshair ticks — longer for visibility */}
        {[
          { style: { top:'50%', left:'-1.6vw', width:'1.0vw', height:'2px', transform:'translateY(-50%)' }},
          { style: { top:'50%', right:'-1.6vw', width:'1.0vw', height:'2px', transform:'translateY(-50%)' }},
          { style: { left:'50%', top:'-1.6vw', width:'2px', height:'1.0vw', transform:'translateX(-50%)' }},
          { style: { left:'50%', bottom:'-1.6vw', width:'2px', height:'1.0vw', transform:'translateX(-50%)' }},
        ].map((t,i) => (
          <div key={i} style={{ position:'absolute', background:'rgba(210,255,210,0.92)', boxShadow:'0 0 4px rgba(0,255,80,0.5)', ...t.style }} />
        ))}
        {/* Range readout near pipper */}
        <div style={{
          position: 'absolute', bottom: '-2.2vw', left: '50%', transform: 'translateX(-50%)',
          fontSize: '0.85vw', whiteSpace: 'nowrap', opacity: 0.92, ...phosphor,
          background: 'rgba(0,14,2,0.55)', padding: '0 4px',
        }}>
          {Math.round(range).toLocaleString()} FT
        </div>
      </div>

      {/* ── PICKLE / FIRE indicator (blinking) ── */}
      <div style={{
        position: 'absolute', bottom: '5.5%', left: '50%',
        transform: 'translateX(-50%)',
        fontSize: '1.05vw', textAlign: 'center',
        opacity: blinkOn ? 1 : 0,
        ...phosphor,
        pointerEvents: 'none',
        letterSpacing: '0.22em',
        fontWeight: 'bold',
      }}>
        ▲  CLICK TO PICKLE  ▲
      </div>

      {/* Diamond aircraft symbol bottom-center (like the real HUD) */}
      <div style={{
        position: 'absolute', bottom: '9%', left: '50%',
        transform: 'translateX(-50%) rotate(45deg)',
        width: '10px', height: '10px',
        border: '1.5px solid rgba(188,255,188,0.8)',
        pointerEvents: 'none', ...phosphor,
      }} />
    </div>
  );
};

const NukeImpactOverlay = ({ blastFx }) => {
  if (!blastFx?.active) return null;

  const type = blastFx.type || 'nuke';

  // ── ORBITAL LANCE: precision electric-cyan beam impact ──
  if (type === 'orbital_lance') {
    const flashOpacity  = Math.max(0, 1 - blastFx.progress * 3.8) * 0.86 * blastFx.intensity;
    const beamOpacity   = Math.max(0, 1 - Math.abs(blastFx.progress - 0.10) / 0.22) * 0.64 * blastFx.intensity;
    const ringOpacity   = Math.max(0, 1 - blastFx.progress * 1.5) * 0.46 * blastFx.intensity;
    const crackleOpacity = Math.max(0, 1 - blastFx.progress * 2.4) * 0.28 * blastFx.intensity;
    const glareScale = lerpNumber(0.35, 3.0, Math.min(1, blastFx.progress * 2.8));
    const ringScale  = lerpNumber(0.08, 3.6, Math.pow(Math.min(1, blastFx.progress * 1.4), 0.60));
    return (
      <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden" style={{ animation: 'fallout-shake-light 0.42s ease-out' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: flashOpacity, background: 'radial-gradient(circle at center, rgba(224,242,254,0.98) 0%, rgba(56,189,248,0.72) 18%, rgba(14,165,233,0.28) 44%, rgba(0,0,0,0) 72%)', mixBlendMode: 'screen' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: '20vmax', height: '20vmax', transform: `translate(-50%, -50%) scale(${glareScale})`, opacity: beamOpacity, borderRadius: '999px', background: 'radial-gradient(circle, rgba(240,249,255,0.98) 0%, rgba(56,189,248,0.62) 30%, rgba(14,165,233,0.18) 56%, rgba(0,0,0,0) 74%)', filter: 'blur(10px)' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: '22vmax', height: '22vmax', transform: `translate(-50%, -50%) scale(${ringScale})`, opacity: ringOpacity, borderRadius: '999px', border: '1.5px solid rgba(125,211,252,0.92)', boxShadow: '0 0 32px rgba(56,189,248,0.5), inset 0 0 20px rgba(224,242,254,0.12)' }} />
        <div style={{ position: 'absolute', inset: '-6%', opacity: crackleOpacity, background: 'radial-gradient(circle at 50% 50%, rgba(56,189,248,0.20) 0%, rgba(14,165,233,0.08) 24%, rgba(0,0,0,0) 46%)', filter: 'blur(9px)' }} />
      </div>
    );
  }

  // ── FIRESTORM: rolling orange-fire spread ──
  if (type === 'firestorm') {
    const flashOpacity = Math.max(0, 1 - blastFx.progress * 1.9) * 0.56 * blastFx.intensity;
    const heatOpacity  = Math.max(0, 1 - Math.max(0, blastFx.progress - 0.05) / 0.85) * 0.52 * blastFx.intensity;
    const glowOpacity  = Math.max(0, 1 - blastFx.progress * 1.0) * 0.38 * blastFx.intensity;
    const dustOpacity  = Math.max(0, 1 - Math.max(0, blastFx.progress - 0.10) / 0.90) * 0.34 * blastFx.intensity;
    const glareScale = lerpNumber(0.5, 3.4, Math.pow(Math.min(1, blastFx.progress * 1.3), 0.52));
    const heatScale  = lerpNumber(0.9, 1.9, Math.min(1, blastFx.progress * 0.88));
    return (
      <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden" style={{ animation: 'fallout-fire-shudder 0.55s ease-out' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: flashOpacity, background: 'radial-gradient(circle at center, rgba(255,237,168,0.96) 0%, rgba(249,115,22,0.74) 24%, rgba(220,38,38,0.22) 54%, rgba(0,0,0,0) 80%)', mixBlendMode: 'screen' }} />
        <div style={{ position: 'absolute', left: '50%', top: '52%', width: '32vmax', height: '32vmax', transform: `translate(-50%, -50%) scale(${glareScale})`, opacity: heatOpacity, borderRadius: '999px', background: 'radial-gradient(circle, rgba(254,215,170,0.88) 0%, rgba(249,115,22,0.55) 34%, rgba(194,65,12,0.18) 60%, rgba(0,0,0,0) 76%)', filter: 'blur(20px)' }} />
        <div style={{ position: 'absolute', inset: '-14%', opacity: glowOpacity, transform: `scale(${heatScale})`, background: 'radial-gradient(circle at 50% 58%, rgba(251,191,36,0.18) 0%, rgba(249,115,22,0.10) 20%, rgba(255,255,255,0) 40%)', filter: 'blur(14px)' }} />
        <div style={{ position: 'absolute', inset: 0, opacity: dustOpacity, background: 'radial-gradient(circle at 50% 54%, rgba(120,53,15,0.06) 0%, rgba(120,53,15,0.24) 38%, rgba(0,0,0,0.48) 100%)', mixBlendMode: 'screen' }} />
      </div>
    );
  }

  // ── KINETIC SPEAR: white-silver hypervelocity impact with concentric rings ──
  if (type === 'kinetic_spear') {
    const flashOpacity = Math.max(0, 1 - blastFx.progress * 4.4) * 0.96 * blastFx.intensity;
    const shockOpacity = Math.max(0, 1 - Math.abs(blastFx.progress - 0.12) / 0.20) * 0.54 * blastFx.intensity;
    const ring1Opacity = Math.max(0, 1 - blastFx.progress * 1.7) * 0.50 * blastFx.intensity;
    const ring2Opacity = Math.max(0, 1 - Math.max(0, blastFx.progress - 0.06) / 0.74) * 0.30 * blastFx.intensity;
    const glareScale = lerpNumber(0.30, 2.8, Math.min(1, blastFx.progress * 3.4));
    const ring1Scale = lerpNumber(0.12, 3.8, Math.pow(Math.min(1, blastFx.progress * 1.3), 0.56));
    const ring2Scale = lerpNumber(0.08, 5.2, Math.pow(Math.min(1, blastFx.progress * 1.1), 0.50));
    return (
      <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden" style={{ animation: 'fallout-seismic-shake 0.65s ease-out' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: flashOpacity, background: 'radial-gradient(circle at center, rgba(248,250,252,0.99) 0%, rgba(226,232,240,0.84) 16%, rgba(147,197,253,0.24) 38%, rgba(0,0,0,0) 66%)', mixBlendMode: 'screen' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: '22vmax', height: '22vmax', transform: `translate(-50%, -50%) scale(${glareScale})`, opacity: shockOpacity, borderRadius: '999px', background: 'radial-gradient(circle, rgba(248,250,252,0.96) 0%, rgba(186,230,253,0.55) 28%, rgba(56,189,248,0.12) 52%, rgba(0,0,0,0) 68%)', filter: 'blur(8px)' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: '18vmax', height: '18vmax', transform: `translate(-50%, -50%) scale(${ring1Scale})`, opacity: ring1Opacity, borderRadius: '999px', border: '2px solid rgba(226,232,240,0.95)', boxShadow: '0 0 26px rgba(186,230,253,0.55), inset 0 0 14px rgba(248,250,252,0.10)' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: '26vmax', height: '26vmax', transform: `translate(-50%, -50%) scale(${ring2Scale})`, opacity: ring2Opacity, borderRadius: '999px', border: '1px solid rgba(125,211,252,0.64)', boxShadow: '0 0 18px rgba(56,189,248,0.32)' }} />
      </div>
    );
  }

  // ── Default: NUKE (nuclear detonation) ──
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

const RTSSelectionOverlay = () => {
  const [overlay, setOverlay] = useState({ box: null, count: 0, squads: 0, engineers: 0, armor: 0 });

  useEffect(() => {
    const interval = setInterval(() => {
      const stats = window._falloutGameStats || {};
      const selection = stats.selection || {};
      setOverlay({
        box: window._falloutSelectionBox || null,
        count: window._falloutSelectedUnitCount || 0,
        squads: selection.squads || 0,
        engineers: selection.engineers || 0,
        armor: selection.armor || 0
      });
    }, 33);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {overlay.box && (
        <div
          className="absolute z-40 pointer-events-none border border-lime-300/80 bg-lime-300/10"
          style={{
            left: overlay.box.left,
            top: overlay.box.top,
            width: overlay.box.width,
            height: overlay.box.height,
            boxShadow: '0 0 14px rgba(163,230,53,0.22)'
          }}
        />
      )}
      {overlay.count > 0 && (
        <div
          className="absolute top-4 right-28 z-40 pointer-events-none rounded-xl border border-lime-400/35 bg-black/60 px-3 py-2 text-[11px] font-mono uppercase tracking-[0.28em] text-lime-200 backdrop-blur-sm"
        >
          Group {overlay.count} | SQ {overlay.squads} | EN {overlay.engineers} | AR {overlay.armor}
        </div>
      )}
    </>
  );
};

const GroupSelectionIndicator = ({ entitiesRef }) => {
  const groupRef = useRef();
  const outerRingRef = useRef();
  const innerRingRef = useRef();
  const pulseRef = useRef();
  const commandLineRef = useRef();
  const targetRingRef = useRef();
  const targetDotRef = useRef();

  useFrame((state) => {
    if (!groupRef.current) return;
    const selectedIds = new Set(window._falloutSelectedUnitIds || []);
    const selectedUnits = entitiesRef.current.filter((entity) => (
      isCommandableUnit(entity) &&
      !entity.dead &&
      (selectedIds.has(entity.id) || entity.selected)
    ));
    if (selectedUnits.length < 2) {
      groupRef.current.visible = false;
      return;
    }

    let centerX = 0;
    let centerZ = 0;
    selectedUnits.forEach((unit) => {
      centerX += unit.x || 0;
      centerZ += unit.z || 0;
    });
    centerX /= selectedUnits.length;
    centerZ /= selectedUnits.length;

    let maxDist = 26;
    selectedUnits.forEach((unit) => {
      maxDist = Math.max(maxDist, Math.hypot((unit.x || 0) - centerX, (unit.z || 0) - centerZ));
    });

    const radius = Math.max(34, maxDist + 22);
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 3.4) * 0.025;
    groupRef.current.visible = true;
    groupRef.current.position.set(centerX, getTerrainHeight(centerX, centerZ) + 1.2, centerZ);
    groupRef.current.rotation.y = 0;

    if (outerRingRef.current) {
      outerRingRef.current.scale.set(radius, radius, 1);
    }
    if (innerRingRef.current) {
      innerRingRef.current.scale.set(radius * 0.7, radius * 0.7, 1);
    }
    if (pulseRef.current) {
      const pulseScale = radius * pulse;
      pulseRef.current.scale.set(pulseScale, pulseScale, 1);
      if (pulseRef.current.material) {
        pulseRef.current.material.opacity = 0.14 + Math.sin(state.clock.elapsedTime * 3.4) * 0.025;
      }
    }

    const hasPlacementMode = !!(window._falloutPendingDeploy || window._falloutPendingBuild || window._falloutArmedSupportKey);
    const hoveredTarget = !hasPlacementMode ? window._falloutMouseTarget : null;
    const storedCommandTarget = window._falloutGroupCommandTarget;
    const showStoredTarget = storedCommandTarget && Date.now() - (storedCommandTarget.at || 0) < 1800;
    const target = hoveredTarget || (showStoredTarget ? storedCommandTarget : null);

    if (commandLineRef.current) {
      commandLineRef.current.visible = !!target;
    }
    if (targetRingRef.current) {
      targetRingRef.current.visible = !!target;
    }
    if (targetDotRef.current) {
      targetDotRef.current.visible = !!target;
    }

    if (target) {
      const targetY = getTerrainHeight(target.x, target.z) + 0.8;
      const dx = target.x - centerX;
      const dz = target.z - centerZ;
      const distance = Math.max(10, Math.hypot(dx, dz));
      const angle = Math.atan2(dx, dz);
      const midX = centerX + dx * 0.5;
      const midZ = centerZ + dz * 0.5;
      const lineY = Math.max(getTerrainHeight(midX, midZ), Math.min(targetY, groupRef.current.position.y)) + 0.6;

      if (commandLineRef.current) {
        commandLineRef.current.position.set(midX, lineY, midZ);
        commandLineRef.current.rotation.set(-Math.PI / 2, angle, 0);
        commandLineRef.current.scale.set(distance, 1.4, 1);
      }

      if (targetRingRef.current) {
        targetRingRef.current.position.set(target.x, targetY, target.z);
        targetRingRef.current.rotation.set(-Math.PI / 2, 0, 0);
        const targetScale = hoveredTarget ? 18 : 16;
        targetRingRef.current.scale.set(targetScale, targetScale, 1);
      }

      if (targetDotRef.current) {
        targetDotRef.current.position.set(target.x, targetY + 0.02, target.z);
        targetDotRef.current.rotation.set(-Math.PI / 2, 0, 0);
        const dotScale = hoveredTarget ? 4.8 : 4.2;
        targetDotRef.current.scale.set(dotScale, dotScale, 1);
      }
    }
  });

  return (
    <group ref={groupRef} visible={false} renderOrder={7}>
      <mesh ref={outerRingRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.96, 1, 56]} />
        <meshBasicMaterial color="#86efac" transparent opacity={0.92} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={innerRingRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.94, 1, 40]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.42} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={pulseRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.92, 1, 48]} />
        <meshBasicMaterial color="#4ade80" transparent opacity={0.18} depthWrite={false} toneMapped={false} />
      </mesh>
      {Array.from({ length: 4 }, (_, index) => (
        <mesh
          key={`group-tick-${index}`}
          position={[0, 1.24, 0]}
          rotation={[-Math.PI / 2, 0, (Math.PI / 2) * index]}
        >
          <planeGeometry args={[0.24, 0.02]} />
          <meshBasicMaterial color="#bbf7d0" transparent opacity={0.72} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      <mesh ref={commandLineRef} visible={false}>
        <planeGeometry args={[1, 0.06]} />
        <meshBasicMaterial color="#86efac" transparent opacity={0.72} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={targetRingRef} visible={false}>
        <ringGeometry args={[0.82, 1, 40]} />
        <meshBasicMaterial color="#bbf7d0" transparent opacity={0.8} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={targetDotRef} visible={false}>
        <ringGeometry args={[0.38, 1, 24]} />
        <meshBasicMaterial color="#4ade80" transparent opacity={0.56} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
};

const ProductionBuildingIndicator = ({ entitiesRef }) => {
  const groupRef = useRef();
  const ringRef = useRef();
  const pulseRef = useRef();

  useFrame((state) => {
    const selectedBuilding = window._falloutSelectedProductionBuilding;
    const entity = selectedBuilding?.id
      ? entitiesRef.current.find((item) => item.id === selectedBuilding.id && item.type === 'facility' && !item.dead && !item.constructing && !isBrokenStructure(item))
      : null;

    if (!groupRef.current) return;
    if (!entity) {
      groupRef.current.visible = false;
      return;
    }

    const baseRadius = Math.max(18, 18 * (entity.visualScale || 1));
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.8) * 0.04;
    const y = getTerrainHeight(entity.x, entity.z) + 0.9;
    groupRef.current.visible = true;
    groupRef.current.position.set(entity.x, y, entity.z);
    groupRef.current.rotation.y = 0;

    if (ringRef.current) ringRef.current.scale.set(baseRadius, baseRadius, 1);
    if (pulseRef.current) {
      pulseRef.current.scale.set(baseRadius * pulse, baseRadius * pulse, 1);
      if (pulseRef.current.material) {
        pulseRef.current.material.opacity = 0.16 + Math.sin(state.clock.elapsedTime * 2.8) * 0.03;
      }
    }
  });

  return (
    <group ref={groupRef} visible={false} renderOrder={7}>
      <mesh ref={pulseRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1, 40]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.16} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.94, 1, 48]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.82} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, 8, 0]}>
        <cylinderGeometry args={[0.55, 0.55, 12, 10]} />
        <meshBasicMaterial color="#a5f3fc" transparent opacity={0.8} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
};

const AttackTargetIndicator = ({ entitiesRef }) => {
  const groupRef = useRef();
  const groundRingRef = useRef();
  const topRingRef = useRef();
  const beamRef = useRef();

  useFrame((state) => {
    if (!groupRef.current) return;

    const selectedIds = new Set(window._falloutSelectedUnitIds || []);
    if (!selectedIds.size) {
      groupRef.current.visible = false;
      return;
    }

    const targetCounts = new Map();
    entitiesRef.current.forEach((entity) => {
      if (!isCommandableUnit(entity) || entity.dead || !selectedIds.has(entity.id)) return;
      if (entity.orderType !== 'attack' || !entity.orderTargetId) return;
      targetCounts.set(entity.orderTargetId, (targetCounts.get(entity.orderTargetId) || 0) + 1);
    });

    let targetId = null;
    let targetCount = 0;
    targetCounts.forEach((count, id) => {
      if (count > targetCount) {
        targetCount = count;
        targetId = id;
      }
    });

    const target = targetId
      ? entitiesRef.current.find((entity) => entity.id === targetId && entity.type === 'kaiju' && !isKaijuDefeated(entity))
      : null;

    if (!target) {
      groupRef.current.visible = false;
      return;
    }

    const baseY = getTerrainHeight(target.x, target.z) + 1.4;
    const targetHeight = Math.max(44, (target.scale || 1) * 28);
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 4.8) * 0.06;
    const ringRadius = Math.max(20, 16 + (target.scale || 1) * 6.5);

    groupRef.current.visible = true;
    groupRef.current.position.set(target.x, baseY, target.z);

    if (groundRingRef.current) {
      groundRingRef.current.scale.set(ringRadius * pulse, ringRadius * pulse, 1);
    }
    if (topRingRef.current) {
      topRingRef.current.position.y = targetHeight;
      topRingRef.current.scale.set((ringRadius * 0.72) * pulse, (ringRadius * 0.72) * pulse, 1);
    }
    if (beamRef.current) {
      beamRef.current.position.y = targetHeight * 0.5;
      beamRef.current.scale.set(1, targetHeight, 1);
      if (beamRef.current.material) {
        beamRef.current.material.opacity = 0.18 + Math.sin(state.clock.elapsedTime * 4.8) * 0.04;
      }
    }
  });

  return (
    <group ref={groupRef} visible={false} renderOrder={8}>
      <mesh ref={groundRingRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1, 40]} />
        <meshBasicMaterial color="#f87171" transparent opacity={0.88} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={beamRef}>
        <cylinderGeometry args={[0.3, 0.3, 1, 8]} />
        <meshBasicMaterial color="#fb7185" transparent opacity={0.2} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={topRingRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.82, 1, 28]} />
        <meshBasicMaterial color="#fecaca" transparent opacity={0.74} depthWrite={false} toneMapped={false} />
      </mesh>
      {Array.from({ length: 4 }, (_, index) => (
        <mesh
          key={`attack-target-tick-${index}`}
          position={[0, 0.05, 0]}
          rotation={[-Math.PI / 2, 0, (Math.PI / 2) * index]}
        >
          <planeGeometry args={[0.28, 0.03]} />
          <meshBasicMaterial color="#fecaca" transparent opacity={0.86} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
};

const UnitCommandMarkers = () => {
  const markerRefs = useRef([]);

  useFrame((state) => {
    const markers = (window._falloutUnitCommandMarkers || []).filter((marker) => Date.now() - (marker.at || 0) < 2200);
    if (typeof window !== 'undefined') {
      window._falloutUnitCommandMarkers = markers;
    }
    markerRefs.current.forEach((ref, index) => {
      if (!ref) return;
      const marker = markers[index];
      if (!marker) {
        ref.visible = false;
        return;
      }
      const age = (Date.now() - (marker.at || 0)) / 2200;
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 7 + index * 0.8) * 0.08;
      const scale = (marker.type === 'attack' ? 9 : marker.type === 'attack_move' ? 7.5 : 6.5) * pulse * (1 - age * 0.22);
      ref.visible = true;
      ref.position.set(marker.x, getTerrainHeight(marker.x, marker.z) + 0.65, marker.z);
      ref.rotation.set(-Math.PI / 2, 0, 0);
      ref.scale.set(scale, scale, 1);
      if (ref.material) {
        ref.material.opacity = Math.max(0, 0.9 - age * 0.7);
        ref.material.color.set(marker.type === 'attack' ? '#fca5a5' : marker.type === 'attack_move' ? '#93c5fd' : '#86efac');
      }
    });
  });

  return (
    <group renderOrder={8}>
      {Array.from({ length: 16 }, (_, index) => (
        <mesh
          key={`unit-command-marker-${index}`}
          ref={(node) => { markerRefs.current[index] = node; }}
          visible={false}
        >
          <ringGeometry args={[0.72, 1, 28]} />
          <meshBasicMaterial transparent opacity={0.85} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
};

export default function FalloutPeople({ theme, isIdleMode }) {
  const isFallout = (theme === 'retro' || theme === 'fallout') && isIdleMode;
  const { data: session } = useSession();
  
  const [nukeCount, setNukeCount] = useState(0);
  const [activeTheme, setActiveTheme] = useState(null);
  const [environmentVariant, setEnvironmentVariant] = useState(() => ENVIRONMENT_VARIANTS[0]);
  const [gameState, setGameState] = useState('playing'); // 'playing', 'won', 'lost'
  const [retryId, setRetryId] = useState(0);
  const [resolutionPreset, setResolutionPreset] = useState(getInitialResolutionPreset);
  const [fpsCap, setFpsCap] = useState(getInitialFpsCap);
  const [currentLevel, setCurrentLevel] = useState(1);
  const [blastFx, setBlastFx] = useState({ active: false, progress: 0, intensity: 0, type: 'nuke', screenX: 50, screenY: 50 });
  const [stressLevel, setStressLevel] = useState('normal');
  const [bombCamActive, setBombCamActive] = useState(false);
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
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('fallout-fps-cap', fpsCap);
  }, [fpsCap]);

  useEffect(() => {
    if (!isFallout) return undefined;
    const id = setInterval(() => {
      setBombCamActive(!!window._falloutBombCamActive);
    }, 300);
    return () => clearInterval(id);
  }, [isFallout]);

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
      const strikeType = detail.type || 'nuke';
      fxStart = performance.now();
      fxDuration = strikeType === 'firestorm'      ? 1600 + intensity * 280
                 : strikeType === 'kinetic_spear'  ? 920  + intensity * 180
                 : strikeType === 'orbital_lance'  ? 1050 + intensity * 200
                 :                                   1150 + intensity * 260;
      setStressLevel('critical');
      setBlastFx({
        active: true,
        progress: 0,
        intensity,
        type: strikeType,
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
      setEnvironmentVariant(pickRandomEnvironmentVariant());
      window._nukeInteractionTriggered = false;
      setActiveTheme(THEMES[Math.floor(Math.random() * THEMES.length)]);
      runProgressRef.current = { maxLevel: 1, kaijuKills: 0, nukesUsed: 0 };
      resultSavedRef.current = false;
      lastProgressSignatureRef.current = '';
    } else {
      setActiveTheme(null);
      setEnvironmentVariant(ENVIRONMENT_VARIANTS[0]);
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

  useEffect(() => {
    if (!isFallout) return undefined;
    const handleEnvironmentShift = () => {
      setEnvironmentVariant((previous) => pickRandomEnvironmentVariant(previous?.key));
    };
    window.addEventListener('fallout-level-environment-shift', handleEnvironmentShift);
    return () => window.removeEventListener('fallout-level-environment-shift', handleEnvironmentShift);
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
    .lerp(new THREE.Color(activeTheme.groundPolluted), Math.min(pollution * 1.35, 1))
    .lerp(new THREE.Color('#4b3a2f'), Math.max(0, (pollution - 0.72) * 1.15))
    .getStyle();
  
  // Sun: yellow → blood red, stays above horizon
  const sunColor = new THREE.Color(activeTheme.sunColor)
    .lerp(new THREE.Color('#dc2626'), pollution)
    .lerp(new THREE.Color('#7f1d1d'), Math.max(0, pollution - 0.7) * 3);
  // Sun always stays above horizon (min 150), sinks with pollution
  const sunY = Math.max(150, 400 * (1 - pollution * 0.8));
  const sunSize = 800 * (1 + pollution * 0.5); // Reduced size for performance
  
  // Fog: slightly transparent so we can still see things
  const fogColor = new THREE.Color(environmentVariant?.fog || bgColor).lerp(new THREE.Color(bgColor), 0.42);
  const fogNear = 1450 - pollution * 380;
  const fogFar = 3600 - pollution * 700;
  
  // Ambient Brightness (Keeps the scene well-lit even at max pollution)
  const ambientIntensity = Math.max(2.15, 2.55 - pollution * 0.18);
  const directionalIntensity = Math.max(1.45, 1.95 - pollution * 0.2);
  const hemisphereIntensity = Math.max(0.7, 0.95 - pollution * 0.08);
  const fillLightIntensity = Math.max(0.5, 0.78 - pollution * 0.08);

  return (
    <div className="fixed inset-0 z-[5] pointer-events-none" style={{ overflow: 'hidden' }}>
      {/* Apocalyptic screen overlay (progressive vignette + color grading) */}
      {pollution > 0.1 && (
        <div 
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background: `radial-gradient(circle, transparent 64%, rgba(0,0,0,${pollution * 0.12}) 100%)`,
            backgroundColor: `rgba(255, 140, 40, ${pollution * 0.035})`
          }}
        />
      )}
      {/* Radioactive dust / ash overlay */}
      {pollution > 0.3 && (
        <div 
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background: `linear-gradient(transparent, rgba(120, 53, 15, ${pollution * 0.08}))`,
            animation: 'fallout-ash-drift 8s linear infinite',
          }}
        />
      )}
      <NukeImpactOverlay blastFx={blastFx} />
      <NukePilotHUD />
      {bombCamActive && <BombCamHUD />}
      
      <Canvas
         key={`fallout-canvas-${resolutionPreset}`}
         className="w-full h-full pointer-events-auto"
         style={{ imageRendering: resolutionProfile.pixelated ? 'pixelated' : 'auto' }}
         frameloop={fpsCap === 'unlimited' ? 'always' : 'demand'}
         shadows={resolutionProfile.shadows ? 'percentage' : false}
         dpr={resolutionProfile.dpr}
         gl={{
           antialias: resolutionProfile.antialias,
           powerPreference: resolutionProfile.dpr >= 1.25 ? 'high-performance' : 'low-power',
           toneMapping: THREE.ACESFilmicToneMapping,
           toneMappingExposure: 1.6
         }}
         camera={{ position: [0, 400, 600], fov: 60, rotation: [-Math.PI / 8, 0, 0], far: 20000 }}
      >
        <FrameRateController fpsCap={fpsCap} />
        {/* === ATMOSPHERIC LIGHTING === */}
        <color attach="background" args={[bgColor]} />
        
        {/* Volumetric fog - intensifies with pollution */}
        <fog attach="fog" args={[fogColor, fogNear, fogFar]} />
        
        {/* Ambient light - warm wasteland tones */}
        <ambientLight 
          intensity={ambientIntensity} 
          color={pollution > 0.5 ? '#ffd2b0' : environmentVariant?.ambient || (pollution > 0.2 ? '#ffe0c7' : '#fff5e6')} 
        />

        <hemisphereLight
          args={[
            pollution > 0.45 ? '#cfe7ff' : '#e5f0ff',
            pollution > 0.45 ? '#5b4638' : '#7a6350',
            hemisphereIntensity
          ]}
        />
        
        {/* Main sun - harsh directional with shadows */}
        <directionalLight 
          position={[200, 500, 200]} 
          intensity={directionalIntensity}
          color={pollution > 0.3 ? '#ffd0a6' : environmentVariant?.directional || '#fffaf0'}
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
            intensity={fillLightIntensity}
            color="#dbeafe"
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
            intensity={0.34}
            color={pollution > 0.3 ? '#ffb36b' : '#ffe29a'}
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
          environmentVariant={environmentVariant}
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
      {gameState === 'playing' && <RTSSelectionOverlay />}
      <SettingsMenu
        resolutionPreset={resolutionPreset}
        setResolutionPreset={setResolutionPreset}
        fpsCap={fpsCap}
        setFpsCap={setFpsCap}
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
      const armedSupportKey = window._falloutArmedSupportKey || (window._falloutManualStrikeArmed ? 'nuke' : null);
      const strikePreview = armedSupportKey
        ? (window._falloutSupportPreview || getSupportStrikePreview(armedSupportKey))
        : getSupportStrikePreview('nuke');
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
        : armedSupportKey
        ? (target || buildFallbackTarget)  // use last known position when mouse is over UI not canvas
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
         
          const outerScale = (strikePreview?.outerRadius || NUKE_DESTRUCTION_PREVIEW_RADIUS) / NUKE_DESTRUCTION_PREVIEW_RADIUS;
          const midScale = (strikePreview?.middleRadius || NUKE_CASUALTY_PREVIEW_RADIUS) / NUKE_CASUALTY_PREVIEW_RADIUS;
          const coreScale = (strikePreview?.coreRadius || NUKE_SEVERE_PREVIEW_RADIUS) / NUKE_SEVERE_PREVIEW_RADIUS;
          if (ring.current) {
            ring.current.rotation.z += 0.05;
            ring.current.visible = !usingPlacementPreview;
            if (ring.current.material) ring.current.material.color.set(strikePreview?.ringColor || '#ef4444');
          }
          if (centerRing.current) {
            centerRing.current.visible = !usingPlacementPreview;
            if (centerRing.current.material) centerRing.current.material.color.set(strikePreview?.ringColor || '#ef4444');
          }
          if (crosshairA.current) {
            crosshairA.current.visible = !usingPlacementPreview;
            if (crosshairA.current.material) crosshairA.current.material.color.set(strikePreview?.beamColor || '#f87171');
          }
          if (crosshairB.current) {
            crosshairB.current.visible = !usingPlacementPreview;
            if (crosshairB.current.material) crosshairB.current.material.color.set(strikePreview?.beamColor || '#f87171');
          }
          if (beamRef.current) {
            beamRef.current.visible = !usingPlacementPreview;
            if (beamRef.current.material) {
              beamRef.current.material.color.set(strikePreview?.beamColor || '#f87171');
              beamRef.current.material.opacity = armedSupportKey === 'orbital_lance' ? 0.18 : armedSupportKey === 'firestorm' ? 0.1 : 0.12;
            }
          }
          if (progressRing.current) {
             progressRing.current.scale.set(progress, progress, 1);
             progressRing.current.visible = !usingPlacementPreview && progress > 0;
             if (progressRing.current.material) progressRing.current.material.color.set(strikePreview?.beamColor || '#f87171');
          }
          if (severePreviewRing.current) {
            severePreviewRing.current.visible = !usingPlacementPreview && !!armedSupportKey;
            severePreviewRing.current.scale.setScalar(coreScale);
            if (severePreviewRing.current.material) severePreviewRing.current.material.color.set(strikePreview?.ringColor || '#ef4444');
          }
          if (casualtyPreviewRing.current) {
            casualtyPreviewRing.current.visible = !usingPlacementPreview && !!armedSupportKey;
            casualtyPreviewRing.current.scale.setScalar(midScale);
            if (casualtyPreviewRing.current.material) casualtyPreviewRing.current.material.color.set(strikePreview?.beamColor || '#fb923c');
          }
          if (destructionPreviewRing.current) {
            destructionPreviewRing.current.visible = !usingPlacementPreview && !!armedSupportKey;
            destructionPreviewRing.current.scale.setScalar(outerScale);
            if (destructionPreviewRing.current.material) destructionPreviewRing.current.material.color.set(strikePreview?.accentColor || '#f59e0b');
          }
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
         {/* Building placement ghost — must be OUTSIDE the flat-rotation group so it renders upright */}
         <group ref={buildGhost} visible={false} position={[0, -8, 0]}>
            <mesh ref={buildGhostCore} position={[0, 1.4, 0]}>
               <cylinderGeometry args={[68, 68, 2.4, 32]} />
               <meshBasicMaterial color="#34d399" transparent opacity={0.28} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            <group ref={buildPowerGhost} visible={false}>
              <mesh position={[0, 14, 0]}>
                <boxGeometry args={[58, 28, 48]} />
                <meshBasicMaterial color="#6ee7b7" transparent opacity={0.24} depthWrite={false} depthTest={false} toneMapped={false} />
              </mesh>
              {[[-14, 36, -8], [14, 36, -8]].map((p, i) => (
                <mesh key={`build-power-stack-${i}`} position={p}>
                  <cylinderGeometry args={[4, 4, 30, 12]} />
                  <meshBasicMaterial color="#a7f3d0" transparent opacity={0.22} depthWrite={false} depthTest={false} toneMapped={false} />
                </mesh>
              ))}
            </group>
            <group ref={buildFactoryGhost} visible={false}>
              <mesh position={[0, 18, 0]}>
                <boxGeometry args={[74, 36, 56]} />
                <meshBasicMaterial color="#6ee7b7" transparent opacity={0.24} depthWrite={false} depthTest={false} toneMapped={false} />
              </mesh>
              <mesh position={[0, 34, -12]}>
                <boxGeometry args={[48, 10, 22]} />
                <meshBasicMaterial color="#a7f3d0" transparent opacity={0.2} depthWrite={false} depthTest={false} toneMapped={false} />
              </mesh>
            </group>
            <group ref={buildAAGhost} visible={false}>
              <mesh position={[0, 11, 0]}>
                <cylinderGeometry args={[30, 34, 20, 16]} />
                <meshBasicMaterial color="#6ee7b7" transparent opacity={0.24} depthWrite={false} depthTest={false} toneMapped={false} />
              </mesh>
              <mesh position={[0, 27, 0]}>
                <boxGeometry args={[28, 8, 20]} />
                <meshBasicMaterial color="#a7f3d0" transparent opacity={0.2} depthWrite={false} depthTest={false} toneMapped={false} />
              </mesh>
            </group>
            <group ref={buildHospitalGhost} visible={false}>
              <mesh position={[0, 14, 0]}>
                <boxGeometry args={[58, 28, 52]} />
                <meshBasicMaterial color="#6ee7b7" transparent opacity={0.24} depthWrite={false} depthTest={false} toneMapped={false} />
              </mesh>
              <mesh position={[0, 28, 18]}>
                <boxGeometry args={[14, 14, 4]} />
                <meshBasicMaterial color="#a7f3d0" transparent opacity={0.2} depthWrite={false} depthTest={false} toneMapped={false} />
              </mesh>
            </group>
            <group ref={buildTechGhost} visible={false}>
              <mesh position={[0, 16, 0]}>
                <cylinderGeometry args={[26, 30, 32, 16]} />
                <meshBasicMaterial color="#6ee7b7" transparent opacity={0.24} depthWrite={false} depthTest={false} toneMapped={false} />
              </mesh>
              <mesh position={[0, 38, 0]}>
                <cylinderGeometry args={[14, 16, 12, 16]} />
                <meshBasicMaterial color="#a7f3d0" transparent opacity={0.2} depthWrite={false} depthTest={false} toneMapped={false} />
              </mesh>
            </group>
            <group ref={buildRadarGhost} visible={false}>
              <mesh position={[0, 11, 0]}>
                <cylinderGeometry args={[22, 28, 20, 16]} />
                <meshBasicMaterial color="#6ee7b7" transparent opacity={0.24} depthWrite={false} depthTest={false} toneMapped={false} />
              </mesh>
              <mesh position={[0, 36, 0]}>
                <cylinderGeometry args={[3.8, 3.8, 38, 12]} />
                <meshBasicMaterial color="#a7f3d0" transparent opacity={0.2} depthWrite={false} depthTest={false} toneMapped={false} />
              </mesh>
            </group>
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

// Per-weapon crater surface styles (floor = scorched center, mid = charred annulus, rim = ejecta, debris = fragments)
const TERRAIN_CRATER_STYLES = {
  nuke:          { floor: '#080403', mid: '#2a180a', rim: '#8a6844', debris: '#a07848' },
  orbital_lance: { floor: '#020408', mid: '#081828', rim: '#1c4868', debris: '#286888' },
  kinetic_spear: { floor: '#040508', mid: '#0c1822', rim: '#2c485e', debris: '#3c6070' },
  warthog:       { floor: '#100804', mid: '#301c0c', rim: '#7a5030', debris: '#9a6840' },
  default:       { floor: '#0a0806', mid: '#201408', rim: '#6a5038', debris: '#8a6848' },
};

const MountainTerrain = memo(({ themeConfig, environmentVariant, pollution, qualityProfile }) => {
  const terrainShaderDetail = qualityProfile?.detailMode || 'full';
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
    const baseColor = environmentVariant?.terrainBase || (themeConfig?.biome === 'wasteland' ? '#4a3d2e' : '#2d4c1e');
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, textureSize, textureSize);
    
    // Add broad grass/dirt variation patches
    for (let i = 0; i < terrainPatchCount; i++) {
        const x = Math.random() * textureSize;
        const y = Math.random() * textureSize;
        const r = 10 + Math.random() * 40;
        const shade = Math.random() > 0.5
          ? (environmentVariant?.patchA || '#5c6d31')
          : (environmentVariant?.patchB || '#3a4a1c');
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = shade;
        ctx.globalAlpha = 0.38;
        ctx.fill();
    }

      // Add medium-scale streaking so the terrain reads like layered soil
      for (let i = 0; i < terrainPatchCount * 0.75; i++) {
        const x = Math.random() * textureSize;
        const y = Math.random() * textureSize;
        const len = 12 + Math.random() * 48;
        const ang = Math.random() * Math.PI;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
        ctx.strokeStyle = Math.random() > 0.5
          ? (environmentVariant?.debrisA || '#6a5a45')
          : (environmentVariant?.debrisB || '#4d453b');
        ctx.globalAlpha = 0.08;
        ctx.lineWidth = 2 + Math.random() * 4;
        ctx.stroke();
      }
    
    // Add dirt/cracks pattern
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = environmentVariant?.crack || '#2a1f18';
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
    
    // Add medium stones / debris
    ctx.globalAlpha = 0.28;
    for (let i = 0; i < terrainDebrisCount; i++) {
        const x = Math.random() * textureSize;
        const y = Math.random() * textureSize;
        const size = 1 + Math.random() * 3;
        ctx.fillStyle = Math.random() > 0.5
          ? (environmentVariant?.debrisA || '#6a5a45')
          : (environmentVariant?.debrisB || '#4d453b');
        ctx.fillRect(x, y, size, size);
    }

    // Add fine gravel/grain so close-up terrain does not read as flat paint
    ctx.globalAlpha = 0.24;
    for (let i = 0; i < terrainDebrisCount * 5; i++) {
        const x = Math.random() * textureSize;
        const y = Math.random() * textureSize;
        const size = 0.5 + Math.random() * 1.4;
        const shade = Math.random() > 0.6
          ? (environmentVariant?.crack || '#2a1f18')
          : (environmentVariant?.debrisA || '#6a5a45');
        ctx.fillStyle = shade;
        ctx.fillRect(x, y, size, size);
    }

    // Add subtle highlight speckle for dusty mineral breakup
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < terrainDebrisCount * 2.5; i++) {
        const x = Math.random() * textureSize;
        const y = Math.random() * textureSize;
        const size = 0.5 + Math.random() * 1.2;
        ctx.fillStyle = environmentVariant?.terrainTint || '#8a745d';
        ctx.fillRect(x, y, size, size);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(14, 14);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = qualityProfile?.terrainAnisotropy || 8;
    texture.needsUpdate = true;
    texture.needsUpdate = true;
    return texture;
  }, [themeConfig, environmentVariant, qualityProfile]);

  const burnMarks = useMemo(() => (
    [...Array(qualityProfile?.burnMarkCount || 8)].map(() => ({
      x: (Math.random() - 0.5) * WORLD_WIDTH,
      z: (Math.random() - 0.5) * WORLD_DEPTH,
      radius: 30 + Math.random() * 50,
      opacity: 0.3 + Math.random() * 0.2
    }))
  ), [qualityProfile?.burnMarkCount]);
  const environmentAccents = useMemo(() => (
    [...Array(8)].map((_, index) => ({
      x: (Math.random() - 0.5) * WORLD_WIDTH * 1.2,
      z: (Math.random() - 0.5) * WORLD_DEPTH * 1.2,
      radius: 36 + Math.random() * 90,
      stretch: 0.5 + Math.random() * 1.1,
      rotation: Math.random() * Math.PI,
      opacity: 0.08 + Math.random() * 0.12,
      lift: 0.18 + index * 0.01
    }))
  ), [environmentVariant?.key]);

  const terrainMeshRef = useRef(null);
  const terrainAnimationEnabled = terrainShaderDetail === 'full';
  const terrainPuddlesEnabled = terrainShaderDetail !== 'minimal';
  const terrainNoiseOctaves = terrainShaderDetail === 'full' ? 4 : terrainShaderDetail === 'lean' ? 3 : 2;

  // ── Dynamic terrain deformation (craters) ─────────────────────────────────
  const [craters, setCraters] = useState([]);
  const appliedCraterIdsRef = useRef(new Set());

  // Expose a global API so the game loop can push craters without prop drilling
  useEffect(() => {
    window._falloutAddCrater = (crater) => {
      const id = crater.id || `crater-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setCraters(prev => [...prev, { ...crater, id }]);
    };
    return () => { delete window._falloutAddCrater; };
  }, []);

  // Deform terrain geometry vertices to create real 3-D bowl craters
  useEffect(() => {
    if (!terrainMeshRef.current?.geometry || craters.length === 0) return;
    const geom = terrainMeshRef.current.geometry;
    // Reset tracking when geometry is rebuilt (segments change)
    if (appliedCraterIdsRef.current._geomUUID !== geom.uuid) {
      appliedCraterIdsRef.current.clear();
      appliedCraterIdsRef.current._geomUUID = geom.uuid;
    }
    const pos = geom.attributes.position;
    let anyNew = false;
    craters.forEach(crater => {
      if (appliedCraterIdsRef.current.has(crater.id)) return;
      appliedCraterIdsRef.current.add(crater.id);
      const r = crater.radius;
      const d = crater.depth;
      for (let i = 0; i < pos.count; i++) {
        // PlaneGeometry: local X = world X, local Y = -world Z (after -π/2 X-rotation)
        const vX = pos.getX(i);
        const vZ = -pos.getY(i);
        const dist = Math.hypot(vX - crater.x, vZ - crater.z);
        if (dist >= r) continue;
        const t = dist / r;
        // Smooth bowl: maximum depth at center, slight upthrow at rim (0.76–1.0)
        const bowl = Math.pow(1.0 - t * t, 2);
        const rim  = t > 0.76 ? Math.pow((t - 0.76) / 0.24, 1.6) * 0.26 : 0;
        pos.setZ(i, pos.getZ(i) - d * bowl + d * rim);
      }
      anyNew = true;
    });
    if (anyNew) {
      pos.needsUpdate = true;
      geom.computeVertexNormals();
    }
  }, [craters, geometry]);

  // Animate terrain shader uniforms every frame
  useFrame((state) => {
    const mat = terrainMeshRef.current?.material;
    if (mat?.uniforms) {
      if (terrainAnimationEnabled) {
        mat.uniforms.uTime.value = state.clock.elapsedTime;
      }
      mat.uniforms.uPollution.value = THREE.MathUtils.lerp(
        mat.uniforms.uPollution.value,
        pollution,
        0.02
      );
    }
  });

  const terrainShaderMaterial = useMemo(() => {
    const baseColor     = new THREE.Color(environmentVariant?.terrainBase   || '#5a6e35');
    const tintColor     = new THREE.Color(environmentVariant?.terrainTint   || '#7a9045');
    const patchAColor   = new THREE.Color(environmentVariant?.patchA        || '#6b8c42');
    const patchBColor   = new THREE.Color(environmentVariant?.patchB        || '#4a5e28');
    const accentColor   = new THREE.Color(environmentVariant?.accent        || '#a3e635');
    const overlayColor  = new THREE.Color(environmentVariant?.overlay       || '#3b2210');
    const crackColor    = new THREE.Color(environmentVariant?.crack         || '#1a1208');

    return new THREE.ShaderMaterial({
      uniforms: {
        uTime:       { value: 0 },
        uPollution:  { value: pollution },
        uMap:        { value: terrainTexture },
        uBase:       { value: baseColor },
        uTint:       { value: tintColor },
        uPatchA:     { value: patchAColor },
        uPatchB:     { value: patchBColor },
        uAccent:     { value: accentColor },
        uOverlay:    { value: overlayColor },
        uCrack:      { value: crackColor },
      },
      vertexShader: `
        varying vec2  vUv;
        varying vec3  vWorldPos;
        varying vec3  vWorldNormal;
        varying float vHeight;

        void main() {
          vUv         = uv;
          // World-space normal (correct for directional lighting)
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wPos   = modelMatrix * vec4(position, 1.0);
          vWorldPos   = wPos.xyz;
          // position.z is terrain elevation in local PlaneGeometry space
          vHeight     = position.z;
          gl_Position = projectionMatrix * viewMatrix * wPos;
        }
      `,
      fragmentShader: `
        uniform float     uTime;
        uniform float     uPollution;
        uniform sampler2D uMap;
        uniform vec3      uBase;
        uniform vec3      uTint;
        uniform vec3      uPatchA;
        uniform vec3      uPatchB;
        uniform vec3      uAccent;
        uniform vec3      uOverlay;
        uniform vec3      uCrack;

        varying vec2  vUv;
        varying vec3  vWorldPos;
        varying vec3  vWorldNormal;
        varying float vHeight;

        // Quick value noise
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < ${terrainNoiseOctaves}; i++) {
            v += a * noise(p);
            p *= 2.1;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          // ── Base texture from canvas (patches/cracks/debris) ──────────────
          vec3 tex = texture2D(uMap, vUv * 0.25).rgb;
          vec3 texFine = texture2D(uMap, vUv * 0.85 + vec2(0.13, 0.07)).rgb;
          vec3 texMacro = texture2D(uMap, vUv * 0.09 + vec2(0.41, 0.23)).rgb;

          // ── World-space FBM noise for large terrain variation ─────────────
          vec2 wUv   = vWorldPos.xz * 0.0018;
          float n1   = fbm(wUv + 0.5);
          float n2   = fbm(wUv * 2.3 + vec2(4.2, 1.7));
          float n3   = fbm(wUv * 6.4 + vec2(2.1, 7.4));

          // ── Base color blend with terrain tint ───────────────────────────
          vec3 ground = mix(uBase, uTint, n1 * 0.7);
          ground      = mix(ground, uPatchA, smoothstep(0.6, 0.8, n2) * 0.5);
          ground      = mix(ground, uPatchB, smoothstep(0.7, 0.9, 1.0 - n1) * 0.4);

          // Merge with texture detail more aggressively so the terrain reads textured
          float texLuma = dot(tex, vec3(0.299, 0.587, 0.114));
          float texFineLuma = dot(texFine, vec3(0.299, 0.587, 0.114));
          float texMacroLuma = dot(texMacro, vec3(0.299, 0.587, 0.114));
          float texContrast = clamp((texLuma - 0.5) * 1.65 + 0.5, 0.0, 1.0);
          float texFineContrast = clamp((texFineLuma - 0.5) * 2.1 + 0.5, 0.0, 1.0);
          ground = mix(ground, ground * (0.72 + texContrast * 0.72), 0.46);
          ground += (texFineContrast - 0.5) * 0.18;
          ground = mix(ground, ground * (0.82 + texMacroLuma * 0.34), 0.24);

          // ── Height-based tinting: valleys darker, peaks lighter ──────────
          float hFactor = clamp((vHeight + 10.0) / 80.0, 0.0, 1.0);
          ground = mix(ground * 0.84, ground * 1.12, hFactor);

          // ── Slope-based rock tinting (normals pointing sideways = cliffs) ─
          float slopeFactor = 1.0 - abs(vWorldNormal.y);
          vec3  rockColor   = mix(uBase * 0.78, vec3(0.50, 0.44, 0.40), 0.55);
          ground = mix(ground, rockColor, smoothstep(0.35, 0.72, slopeFactor) * 0.38);

          // Dry ridges + compacted dirt pockets for stronger terrain breakup
          float compactMask = smoothstep(0.56, 0.74, n3) * clamp(1.0 - slopeFactor * 1.8, 0.0, 1.0);
          vec3 compactColor = mix(uCrack * 1.2, uPatchB * 0.92, 0.45);
          ground = mix(ground, compactColor, compactMask * 0.28);

          float ridgeDust = smoothstep(0.52, 0.86, hFactor) * smoothstep(0.0, 0.45, 1.0 - slopeFactor);
          ground += ridgeDust * (0.045 + texFineContrast * 0.035) * uTint;

          // ── Grass lighting / terrain accents ──────────────────────────────
          ${terrainAnimationEnabled ? `
          float grassMask = smoothstep(0.6, 1.0, n1) * clamp(1.0 - slopeFactor * 2.0, 0.0, 1.0);
          float wind = sin(uTime * 1.8 + vWorldPos.x * 0.12 + vWorldPos.z * 0.09)
                     * cos(uTime * 1.2 + vWorldPos.z * 0.07) * 0.5 + 0.5;
          ground += grassMask * wind * 0.07 * uAccent;
          ` : `
          float grassMask = smoothstep(0.62, 1.0, n1) * clamp(1.0 - slopeFactor * 2.3, 0.0, 1.0);
          ground += grassMask * 0.035 * uAccent;
          `}

          // ── Radiation puddles / wet patches ───────────────────────────────
          ${terrainPuddlesEnabled ? (terrainAnimationEnabled ? `
          float puddle = fbm(wUv * 3.0 + vec2(uTime * 0.04, uTime * 0.03));
          float pudMask = smoothstep(0.62, 0.72, puddle)
                        * smoothstep(0.0, 0.15, hFactor)
                        * clamp(1.0 - slopeFactor * 3.0, 0.0, 1.0);
          vec3 radColor = mix(vec3(0.15, 0.38, 0.08), uAccent * 0.7, uPollution);
          float puddleShimmer = sin(uTime * 3.5 + vWorldPos.x * 0.3) * 0.5 + 0.5;
          ground = mix(ground, radColor * (0.6 + puddleShimmer * 0.4), pudMask * 0.55);
          ` : `
          float puddle = fbm(wUv * 2.4 + vec2(0.8, 1.3));
          float pudMask = smoothstep(0.64, 0.73, puddle)
                        * smoothstep(0.0, 0.16, hFactor)
                        * clamp(1.0 - slopeFactor * 3.2, 0.0, 1.0);
          vec3 radColor = mix(vec3(0.14, 0.34, 0.08), uAccent * 0.58, uPollution);
          ground = mix(ground, radColor * 0.72, pudMask * 0.42);
          `) : ''}

          // ── Pollution overlay (blackens the ground at high pollution) ─────
          ground = mix(ground, uCrack * 0.24 + uOverlay * 0.76, uPollution * 0.22);

          // ── Sky/sun light (directional, world-space) ──────────────────────
          vec3  sunDir  = normalize(vec3(0.4, 1.0, 0.3));
          float NdotL   = max(dot(vWorldNormal, sunDir), 0.0);
          vec3  sunLight = vec3(1.0, 0.97, 0.84) * (0.78 + NdotL * 0.42);

          // Micro surface relief from the detail texture for stronger readability
          float detailShade = clamp(0.82 + (texFineContrast - 0.5) * 0.42 + (n3 - 0.5) * 0.18, 0.68, 1.22);
          sunLight *= detailShade;

          // ── Horizon atmospheric tint (distant terrain slightly hazy) ──────
          float dist = length(vWorldPos.xz) / 1800.0;
          float haze = smoothstep(0.4, 1.0, dist);
          vec3  hazeColor = mix(vec3(0.68, 0.72, 0.58), vec3(0.72, 0.77, 0.84), uPollution);

          // ── Assemble final color ──────────────────────────────────────────
          vec3 final = ground * sunLight;
          final = mix(final, hazeColor * ground * 1.08, haze * 0.22);

          gl_FragColor = vec4(final, 1.0);
        }
      `,
      side: THREE.FrontSide,
      precision: terrainShaderDetail === 'minimal' ? 'mediump' : 'highp',
    });
  }, [environmentVariant, pollution, terrainAnimationEnabled, terrainNoiseOctaves, terrainPuddlesEnabled, terrainShaderDetail, terrainTexture]);

  return (
    <group>
      <mesh
         ref={terrainMeshRef}
         geometry={geometry}
         rotation={[-Math.PI / 2, 0, 0]}
         position={[0, 0, 0]}
         receiveShadow={qualityProfile?.shadows}
         material={terrainShaderMaterial}
      />

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
                opacity={mark.opacity * 0.72}
              />
            </mesh>
          ))}
        </group>
      )}

      {environmentVariant && (
        <group>
          {environmentAccents.map((accent, i) => (
            <mesh
              key={`${environmentVariant.key}-accent-${i}`}
              rotation={[-Math.PI / 2, 0, accent.rotation]}
              position={[accent.x, accent.lift, accent.z]}
              scale={[accent.stretch, 1, 1]}
            >
              <circleGeometry args={[accent.radius, 20]} />
              <meshStandardMaterial
                color={environmentVariant.accent}
                roughness={1}
                transparent
                opacity={accent.opacity}
              />
            </mesh>
          ))}
        </group>
      )}

      {/* Crater decals — dark scorch, charred ring, raised ejecta rim, and debris fragments */}
      {craters.map(crater => {
        const groundY   = getTerrainHeight(crater.x, crater.z);
        const floorY    = groundY - crater.depth * 0.80 + 1.5;
        const rimY      = groundY + 2.4;
        const style     = TERRAIN_CRATER_STYLES[crater.type] || TERRAIN_CRATER_STYLES.default;
        const fragCount = Math.min(14, Math.max(5, Math.floor(crater.radius / 18)));
        return (
          <group key={crater.id}>
            {/* Scorched inner floor */}
            <mesh rotation={[-Math.PI/2, 0, 0]} position={[crater.x, floorY, crater.z]} renderOrder={6}>
              <circleGeometry args={[crater.radius * 0.62, 30]} />
              <meshBasicMaterial color={style.floor} transparent opacity={0.96} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
            </mesh>
            {/* Mid charred annulus */}
            <mesh rotation={[-Math.PI/2, 0, 0]} position={[crater.x, floorY + 0.6, crater.z]} renderOrder={5}>
              <ringGeometry args={[crater.radius * 0.52, crater.radius * 0.90, 28]} />
              <meshBasicMaterial color={style.mid} transparent opacity={0.76} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
            </mesh>
            {/* Raised ejecta rim ring */}
            <mesh rotation={[-Math.PI/2, 0, 0]} position={[crater.x, rimY, crater.z]} renderOrder={7}>
              <ringGeometry args={[crater.radius * 0.82, crater.radius * 1.12, 26]} />
              <meshBasicMaterial color={style.rim} transparent opacity={0.80} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
            </mesh>
            {/* Broken rock / debris fragments scattered around the rim */}
            {Array.from({ length: fragCount }).map((_, fi) => {
              const seed  = ((crater.id?.charCodeAt?.(8) || fi * 17) + fi * 31) % 100;
              const angle = (fi / fragCount) * Math.PI * 2 + seed * 0.063;
              const fr    = crater.radius * (0.88 + (seed % 6) * 0.034);
              const fw    = crater.radius * 0.038 + (seed % 4) * crater.radius * 0.015;
              return (
                <mesh
                  key={fi}
                  rotation={[-Math.PI/2, angle * 0.55, 0]}
                  position={[crater.x + Math.cos(angle) * fr, rimY + 0.9, crater.z + Math.sin(angle) * fr]}
                  renderOrder={8}
                >
                  <planeGeometry args={[fw * 3.2, fw * 1.8]} />
                  <meshBasicMaterial color={style.debris} transparent opacity={0.80} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
                </mesh>
              );
            })}
          </group>
        );
      })}

      {/* Solid base below terrain to prevent holes */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -20, 0]}>
         <planeGeometry args={[WORLD_WIDTH * 4, WORLD_DEPTH * 4]} />
        <meshBasicMaterial color="#2a221c" />
      </mesh>
    </group>
  );
});
