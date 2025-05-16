import type { ClientCommand } from './types';

export class InputHandler {
  private keys: Set<string> = new Set();
  private mouseX: number = 0;
  private mouseY: number = 0;
  private isPointerLocked: boolean = false;

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Keyboard events
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    // Mouse events
    document.addEventListener('mousemove', (e) => {
      if (this.isPointerLocked) {
        this.mouseX += e.movementX;
        this.mouseY += e.movementY;
      }
    });

    // Pointer lock
    document.addEventListener('click', () => {
      if (!this.isPointerLocked) {
        document.body.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement !== null;
    });
  }

  public getCommand(): ClientCommand {
    return {
      moveForward: this.keys.has('w'),
      moveBackward: this.keys.has('s'),
      moveLeft: this.keys.has('a'),
      moveRight: this.keys.has('d'),
      moveUp: this.keys.has('q'),
      moveDown: this.keys.has('e'),
      mouseX: this.mouseX,
      mouseY: this.mouseY,
      timestamp: Date.now()
    };
  }

  public resetMouseDelta(): void {
    this.mouseX = 0;
    this.mouseY = 0;
  }
} 