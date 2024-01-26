import type { RenderPassManager } from './render-pass-manager';
import type { OutlinePass } from './pass/outline-pass';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import type {
  Camera,
  ColorRepresentation,
  Object3D,
  PerspectiveCamera,
  Scene,
} from 'three';

export interface OutlineParameters {
  [key: string]: any;
  enabled: boolean;
  edgeStrength: number;
  edgeGlow: number;
  edgeThickness: number;
  pulsePeriod: number;
  usePatternTexture: false;
  visibleEdgeColor: ColorRepresentation;
  hiddenEdgeColor: ColorRepresentation;
}

export interface OutlineRendererParameters {
  enabled?: boolean;
  edgeStrength?: number;
  edgeGlow?: number;
  edgeThickness?: number;
  pulsePeriod?: number;
  usePatternTexture?: false;
  visibleEdgeColor?: ColorRepresentation;
  hiddenEdgeColor?: ColorRepresentation;
}

export class OutlineRenderer {
  public parameters: OutlineParameters;
  private _renderPassManager: RenderPassManager;
  private _effectComposer: EffectComposer | null = null;
  public outlinePassActivated = false;

  get isOutlinePassActivated(): boolean {
    return this.outlinePassActivated;
  }

  get outlinePass(): OutlinePass | null {
    return this._renderPassManager.outlinePass;
  }

  constructor(
    renderPassManager: RenderPassManager,
    _effectComposer: EffectComposer | null,
    parameters: OutlineRendererParameters
  ) {
    this._renderPassManager = renderPassManager;
    this._effectComposer = _effectComposer;
    this.parameters = {
      enabled: true,
      edgeStrength: 2.0,
      edgeGlow: 1.0,
      edgeThickness: 2.0,
      pulsePeriod: 0,
      usePatternTexture: false,
      visibleEdgeColor: 0xffffff, // 0xdb0000,
      hiddenEdgeColor: 0xffffff, // 0xdb0000,
      ...parameters,
    };
  }

  public updateParameters(parameters: OutlineParameters): void {
    for (const propertyName in parameters) {
      if (this.parameters.hasOwnProperty(propertyName)) {
        this.parameters[propertyName] = parameters[propertyName];
      }
    }
  }

  public applyParameters(): void {
    if (!this.outlinePass) {
      return;
    }
    this.outlinePass.edgeStrength = this.parameters.edgeStrength;
    this.outlinePass.edgeGlow = this.parameters.edgeGlow;
    this.outlinePass.edgeThickness = this.parameters.edgeThickness;
    this.outlinePass.pulsePeriod = this.parameters.pulsePeriod;
    this.outlinePass.usePatternTexture = this.parameters.usePatternTexture;
    this.outlinePass.visibleEdgeColor.set(this.parameters.visibleEdgeColor);
    this.outlinePass.hiddenEdgeColor.set(this.parameters.hiddenEdgeColor);
  }

  public activateOutline(scene: Scene, camera: Camera): void {
    if (!this.parameters.enabled) {
      this.deactivateOutline();
      return;
    }
    const needsUpdate =
      this.outlinePass?.renderCamera &&
      (camera as PerspectiveCamera).isPerspectiveCamera !==
        (this.outlinePass.renderCamera as PerspectiveCamera)
          .isPerspectiveCamera;
    if (this.outlinePass) {
      this.outlinePass.renderScene = scene;
      this.outlinePass.renderCamera = camera;
    }
    if (!needsUpdate && this.outlinePassActivated) {
      return;
    }
    if (needsUpdate || !this.outlinePass) {
      this._renderPassManager.createOutlinePass();
    }
    this.applyParameters();
    if (this._effectComposer) {
      this._effectComposer.addPass(this.outlinePass as OutlinePass);
    }
    this.outlinePassActivated = true;
  }

  public deactivateOutline(): void {
    if (!this.outlinePassActivated) {
      return;
    }
    if (this.outlinePass && this._effectComposer) {
      this._effectComposer.removePass(this.outlinePass);
    }
    this.outlinePassActivated = false;
  }

  public updateOutline(
    scene: Scene,
    camera: Camera,
    selectedObjects: Object3D[]
  ) {
    if (selectedObjects.length > 0) {
      this.activateOutline(scene, camera);
      if (this.outlinePass) {
        this.outlinePass.selectedObjects = selectedObjects;
      }
    } else {
      this.deactivateOutline();
    }
  }
}
