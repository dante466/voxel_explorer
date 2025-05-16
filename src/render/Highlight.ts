import * as THREE from 'three';

const HIGHLIGHT_COLOR = 0xffff00; // Yellow
const HIGHLIGHT_LINE_WIDTH = 2; // Note: THREE.LineBasicMaterial linewidth doesn't work on all platforms/drivers

export class VoxelHighlighter {
  private scene: THREE.Scene;
  private wireframeMesh: THREE.LineSegments | null = null;
  private visible: boolean = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.createWireframeMesh();
  }

  private createWireframeMesh(): void {
    // Create a 1x1x1 cube geometry
    const boxGeometry = new THREE.BoxGeometry(1.01, 1.01, 1.01); // Slightly larger to avoid z-fighting
    const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
    const material = new THREE.LineBasicMaterial({
      color: HIGHLIGHT_COLOR,
      linewidth: HIGHLIGHT_LINE_WIDTH, // May not have an effect, but set anyway
      transparent: true,
      opacity: 0.7,
      depthTest: false, // Render on top
    });

    this.wireframeMesh = new THREE.LineSegments(edgesGeometry, material);
    this.wireframeMesh.renderOrder = 999; // Attempt to render on top
    this.wireframeMesh.visible = false; // Initially hidden
    this.scene.add(this.wireframeMesh);
  }

  /**
   * Updates the highlighter's position and visibility.
   * @param targetVoxelCenterWorldPosition The world coordinates of the center of the voxel to highlight.
   *                                      If null, the highlighter is hidden.
   */
  public update(targetVoxelCenterWorldPosition: THREE.Vector3 | null): void {
    if (!this.wireframeMesh) return;

    if (targetVoxelCenterWorldPosition) {
      this.wireframeMesh.position.copy(targetVoxelCenterWorldPosition);
      if (!this.visible) {
        this.wireframeMesh.visible = true;
        this.visible = true;
      }
    } else {
      if (this.visible) {
        this.wireframeMesh.visible = false;
        this.visible = false;
      }
    }
  }

  public setVisible(visible: boolean): void {
    if (this.wireframeMesh) {
        this.wireframeMesh.visible = visible;
        this.visible = visible;
    }
  }

  public dispose(): void {
    if (this.wireframeMesh) {
      this.scene.remove(this.wireframeMesh);
      this.wireframeMesh.geometry.dispose();
      if (Array.isArray(this.wireframeMesh.material)) {
        this.wireframeMesh.material.forEach(mat => mat.dispose());
      } else {
        this.wireframeMesh.material.dispose();
      }
      this.wireframeMesh = null;
    }
    console.log('VoxelHighlighter disposed.');
  }
} 