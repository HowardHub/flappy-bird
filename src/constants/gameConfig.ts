export const GAME_CONFIG = {
  GRAVITY: 0.6,
  JUMP_STRENGTH: -8,
  PIPE_SPEED: 3,
  PIPE_SPAWN_RATE: 100, // Frames between pipe spawns
  PIPE_WIDTH: 52,
  PIPE_GAP: 150,
  BIRD_RADIUS: 16, // Visual radius
  BIRD_SIZE: 32,   // Collision box size
  GROUND_HEIGHT: 100,
  CANVAS_WIDTH: 400, // Mobile friendly width
  CANVAS_HEIGHT: 600,
  // AI Config
  AI_POPULATION: 50,
  AI_MUTATION_RATE: 0.1,
};

export type GameState = 'READY' | 'PLAYING' | 'GAME_OVER';

export interface Bird {
  x: number;
  y: number;
  velocity: number;
  rotation: number;
}

export interface Pipe {
  x: number;
  topHeight: number;
  passed: boolean;
}
