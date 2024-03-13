import type { Texture } from 'three';
import { Mesh, MeshPhysicalMaterial, PlaneGeometry } from 'three';

export interface ShadowGroundPlaneParameters {
  opacity?: number;
  polygonOffset?: number;
}

export class ShadowGroundPlane extends Mesh {
  public static alphaMap: boolean = true;

  constructor(
    shadowMap: Texture | null,
    parameters?: ShadowGroundPlaneParameters
  ) {
    super(
      new PlaneGeometry(1, 1, 10, 10),
      new MeshPhysicalMaterial({
        color: ShadowGroundPlane.alphaMap ? 0x000000 : 0xffffff,
        transparent: true,
        depthWrite: false,
        //side: DoubleSide,
        polygonOffset: true,
        name: 'ShadowGroundPlaneMaterial',
      })
    );
    this.name = 'ShadowGroundPlane';
    this.userData.isFloor = true;
    this.renderOrder = 1;
    this.receiveShadow = false;
    this.layers.disableAll();
    if (parameters) {
      this.updateMaterial(parameters);
    }
    this.setShadowMap(shadowMap);
  }

  public setVisibility(visible: boolean) {
    this.visible = visible;
    this.setVisibilityLayers(visible);
  }

  public setVisibilityLayers(visible: boolean) {
    if (visible) {
      this.layers.enableAll();
    } else {
      this.layers.disableAll();
    }
  }

  public setDepthWrite(write: boolean) {
    const shadowGroundMaterial = this.material as MeshPhysicalMaterial;
    shadowGroundMaterial.depthWrite = write;
    shadowGroundMaterial.transparent = !write;
    shadowGroundMaterial.needsUpdate = true;
    this.setVisibility(write);
  }

  public setReceiveShadow(receive: boolean) {
    this.receiveShadow = receive;
    this.setVisibility(receive);
  }

  public setShadowMap(shadowMap: Texture | null) {
    const shadowGroundMaterial = this.material as MeshPhysicalMaterial;
    if (ShadowGroundPlane.alphaMap) {
      shadowGroundMaterial.alphaMap = shadowMap;
      shadowGroundMaterial.map = null;
      shadowGroundMaterial.color.set(0x000000);
    } else {
      shadowGroundMaterial.alphaMap = null;
      shadowGroundMaterial.map = shadowMap;
      shadowGroundMaterial.color.set(0xffffff);
    }
    shadowGroundMaterial.needsUpdate = true;
  }

  public updateMaterial(parameters: ShadowGroundPlaneParameters) {
    const shadowGroundMaterial = this.material as MeshPhysicalMaterial;
    if (
      parameters.opacity &&
      shadowGroundMaterial.opacity !== parameters.opacity
    ) {
      shadowGroundMaterial.opacity = parameters.opacity;
    }
    if (
      parameters.polygonOffset &&
      shadowGroundMaterial.polygonOffsetFactor !== parameters.polygonOffset
    ) {
      shadowGroundMaterial.polygonOffset = true;
      shadowGroundMaterial.polygonOffsetFactor = parameters.polygonOffset;
      shadowGroundMaterial.polygonOffsetUnits = parameters.polygonOffset;
    }
    shadowGroundMaterial.needsUpdate = true;
  }
}
