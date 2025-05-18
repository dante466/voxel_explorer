import type { ClientCommand } from './types';

export class InputHandler {
  private keys: Set<string> = new Set();
  private mouseX: number = 0;
  private mouseY: number = 0;

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Keyboard events
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    // Mouse events
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        this.mouseX += e.movementX;
        this.mouseY += e.movementY;
      }
    });
  }

  public getCommand(): ClientCommand {
    return {
      moveForward: this.keys.has('w'),
      moveBackward: this.keys.has('s'),
      moveLeft: this.keys.has('a'),
      moveRight: this.keys.has('d'),
      mouseDeltaX: this.mouseX,
      mouseDeltaY: this.mouseY,
      timestamp: Date.now()
    };
  }

  public resetMouseDelta(): void {
    this.mouseX = 0;
    this.mouseY = 0;
  }
} 