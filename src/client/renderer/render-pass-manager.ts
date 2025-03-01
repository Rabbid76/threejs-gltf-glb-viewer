import { CameraUpdate, getMaxSamples, PassRenderer } from './render-utility';
import { BakedGroundContactShadowPass } from './pass/baked-ground-contact-shadow-pass';
import { GBufferRenderPass } from './pass/gbuffer-render-pass';
import { GroundReflectionPass } from './pass/ground-reflection-pass';
import { ScreenSpaceShadowMapPass } from './pass/screen-space-shadow-map-pass';
import { ShadowAndAoPass } from './pass/shadow-and-ao-pass';
import type { ShadowBlurType } from './pass/shadow-and-ao-pass';
import { OutlinePass } from './pass/outline-pass';
import type { OutlineRenderer } from './outline-renderer';
import { DebugPass } from './pass/debug-pass';
import { SHADOW_BLUR_TYPES } from './pass/shadow-and-ao-pass';
import { SceneRenderPass } from './pass/scene-render-pass';
import type { SceneRenderer, SceneRendererParameters } from './scene-renderer';
import type { Camera, Scene, Texture, WebGLRenderer } from 'three';
import type { ThreeObject3d } from './render-cache';
import { PostProcessingMaterialPlugin } from './materials/postprocessing-material-plugin';
import {
  LinearFilter,
  MeshStandardMaterial,
  NearestFilter,
  Vector2,
} from 'three';
import type { Mesh, Object3D } from 'three';

interface _passUpdateStates {
  updateGBuffer: boolean;
  updateGroundReflection: boolean;
  updateScreenSpaceShadow: boolean;
  updateShadowAndAoPass: boolean;
  updateOutlinePass: boolean;
  updateDebugPass: boolean;
}

interface DynamicPassUpdateRequirements {
  needsUpdate: boolean;
  shadowOnCameraChange: ShadowBlurType;
  intensityScale: number;
}

export class RenderPassManager {
  public materialsNeedUpdate: boolean = true;
  private _sceneRenderer: SceneRenderer;
  private _passRenderer: PassRenderer = new PassRenderer();
  private _sceneRenderPass: SceneRenderPass;
  private _bakedGroundContactShadowPass: BakedGroundContactShadowPass;
  private _gBufferRenderPass: GBufferRenderPass;
  private _groundReflectionPass: GroundReflectionPass;
  private _screenSpaceShadowMapPass: ScreenSpaceShadowMapPass;
  private _shadowAndAoPass: ShadowAndAoPass;
  private _outlinePass: OutlinePass | null = null;
  private _debugPass: DebugPass | null = null;
  private _scene?: Scene;
  private _camera?: Camera;
  private _cameraUpdate: CameraUpdate = new CameraUpdate();
  private _cameraChanged: boolean = true;
  private _noUpdateNeededCount = 0;
  private _noOStaticFrames = 0;
  private _maxSamples: number = 1;
  private _passUpdateStates: _passUpdateStates = {
    updateGroundReflection: false,
    updateGBuffer: false,
    updateScreenSpaceShadow: false,
    updateShadowAndAoPass: false,
    updateOutlinePass: false,
    updateDebugPass: false,
  };
  public aoPassMapTexture: Texture | null = null;

  public get passRenderer(): PassRenderer {
    return this._passRenderer;
  }

  public get scene(): Scene {
    return this._scene as Scene;
  }

  public get camera(): Camera {
    return this._camera as Camera;
  }

  public get aspect(): number {
    return this._sceneRenderer.width / this._sceneRenderer.height;
  }

  public get cameraChanged(): boolean {
    return this._cameraChanged;
  }

  public get noOStaticFrames(): number {
    return this._noOStaticFrames;
  }

  public get renderCacheManager() {
    return this._sceneRenderer.renderCacheManager;
  }

  private get parameters(): SceneRendererParameters {
    return this._sceneRenderer.parameters;
  }

  public get sceneRenderPass(): SceneRenderPass {
    return this._sceneRenderPass;
  }

  public get bakedGroundContactShadowPass(): BakedGroundContactShadowPass {
    return this._bakedGroundContactShadowPass;
  }

  public get gBufferRenderPass(): GBufferRenderPass {
    return this._gBufferRenderPass;
  }

  public get groundReflectionPass(): GroundReflectionPass {
    return this._groundReflectionPass;
  }

  public get screenSpaceShadowMapPass(): ScreenSpaceShadowMapPass {
    return this._screenSpaceShadowMapPass;
  }

  public get shadowAndAoPass(): ShadowAndAoPass {
    return this._shadowAndAoPass;
  }

  public get outlinePass(): OutlinePass | null {
    return this._outlinePass;
  }

  public get outlineRenderer(): OutlineRenderer {
    return this._sceneRenderer.outlineRenderer;
  }

  public get debugPass(): DebugPass {
    this._debugPass ??= new DebugPass(this);
    return this._debugPass;
  }

  public get debugOutput(): string {
    return this._sceneRenderer.debugOutput;
  }

  constructor(sceneRender: SceneRenderer) {
    this._sceneRenderer = sceneRender;
    this._maxSamples = getMaxSamples(this._sceneRenderer.renderer);
    const linearAoFilter = this._sceneRenderer.linearAoFilter;
    const gBufferAndAoSamples = linearAoFilter ? this._maxSamples : 0;
    const shadowSamples = linearAoFilter ? this._maxSamples : 0;
    this._sceneRenderPass = new SceneRenderPass(this);
    this._bakedGroundContactShadowPass = new BakedGroundContactShadowPass(
      this,
      this._sceneRenderer.renderer,
      this._sceneRenderer.groundGroup,
      {
        sharedShadowGroundPlane: this._sceneRenderer.shadowAndAoGroundPlane,
      }
    );
    this._gBufferRenderPass = new GBufferRenderPass(this, {
      shared: true,
      capabilities: this._sceneRenderer.renderer.capabilities,
      width: this._sceneRenderer.width,
      height: this._sceneRenderer.height,
      samples: gBufferAndAoSamples,
      textureMinificationFilter: linearAoFilter ? LinearFilter : NearestFilter,
      textureMagnificationFilter: linearAoFilter ? LinearFilter : NearestFilter,
    });
    this._groundReflectionPass = new GroundReflectionPass(
      this,
      this._sceneRenderer.width,
      this._sceneRenderer.height,
      this._maxSamples,
      {}
    );
    this._screenSpaceShadowMapPass = new ScreenSpaceShadowMapPass(
      this,
      new Vector2(this._sceneRenderer.width, this._sceneRenderer.height),
      {
        samples: shadowSamples,
        alwaysUpdate: false,
      }
    );
    this._shadowAndAoPass = new ShadowAndAoPass(
      this,
      this._sceneRenderer.width,
      this._sceneRenderer.height,
      gBufferAndAoSamples
    );
  }

  public dispose() {
    this._sceneRenderPass.dispose();
    this._bakedGroundContactShadowPass.dispose();
    this._gBufferRenderPass.dispose();
    this._groundReflectionPass.dispose();
    this._screenSpaceShadowMapPass.dispose();
    this._shadowAndAoPass.dispose();
    this._outlinePass?.dispose();
  }

  public setSize(width: number, height: number): void {
    this._gBufferRenderPass.setSize(width, height);
    this._groundReflectionPass.setSize(width, height);
    this._screenSpaceShadowMapPass.setSize(width, height);
    this._shadowAndAoPass.setSize(width, height);
    this._outlinePass?.setSize(width, height);
  }

  public createOutlinePass(): OutlinePass {
    if (!this._outlinePass) {
      this._outlinePass = new OutlinePass(
        this,
        new Vector2(this._sceneRenderer.width, this._sceneRenderer.height),
        this.scene,
        this.camera,
        [],
        {
          downSampleRatio: 2,
          edgeDetectionFxaa: true,
        }
      );
    }
    return this._outlinePass;
  }

  public setGroundVisibility(visible: boolean): void {
    this._sceneRenderer.shadowAndAoGroundPlane.setVisibility(visible);
  }

  public updatePasses(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    this._scene = scene;
    this._camera = camera;
    this._cameraChanged = this._cameraUpdate.changed(camera);
    const updateRequirements = this._evaluateIfShadowAndAoUpdateIsNeeded();
    this._updateSceneRenderPass();
    this._updateBakedGroundContactShadowPass();
    this._updateGBufferPass(updateRequirements);
    this._updateGroundReflectionPass(updateRequirements);
    this._updateScreenSpaceShadowPass(updateRequirements);
    this._updateShadowAndAoPass(updateRequirements);
    this._updateOutlinePass();
    this._updateDebugPass();
  }

  private _evaluateIfShadowAndAoUpdateIsNeeded(): DynamicPassUpdateRequirements {
    const updateNow =
      this._shadowAndAoPass.parameters.alwaysUpdate ||
      this._screenSpaceShadowMapPass.needsUpdate ||
      this._screenSpaceShadowMapPass.shadowTypeNeedsUpdate;
    let needsUpdate =
      (this._shadowAndAoPass.parameters.enabled ||
        this._groundReflectionPass.parameters.enabled) &&
      this._cameraChanged;
    let intensityScale = 1;
    if (needsUpdate) {
      this._noUpdateNeededCount = 0;
      this._noOStaticFrames = 0;
    }
    if (!updateNow) {
      this._noUpdateNeededCount++;
      needsUpdate =
        this._noUpdateNeededCount >= this.parameters.effectSuspendFrames;
      intensityScale = Math.max(
        0,
        Math.min(
          1,
          (this._noUpdateNeededCount - this.parameters.effectSuspendFrames) /
            this.parameters.effectFadeInFrames
        )
      );
    }
    if (!updateNow && intensityScale === 1) {
      this._noOStaticFrames++;
    }
    needsUpdate = updateNow || needsUpdate;
    const shadowOnCameraChange =
      !needsUpdate || intensityScale < 0.99
        ? this.parameters.shadowOnCameraChange
        : SHADOW_BLUR_TYPES.OFF;
    return { needsUpdate, shadowOnCameraChange, intensityScale };
  }

  private _dynamicChanges(
    updateRequirements: DynamicPassUpdateRequirements
  ): boolean {
    return (
      updateRequirements.needsUpdate ||
      updateRequirements.shadowOnCameraChange !== SHADOW_BLUR_TYPES.OFF
    );
  }

  private _updateSceneRenderPass() {
    this._sceneRenderPass.drawWithDebugMaterial = false;
  }

  private _updateBakedGroundContactShadowPass() {
    const limitPlaneSize = this._bakedGroundContactShadowPass.limitPlaneSize;
    this._bakedGroundContactShadowPass.limitPlaneSize =
      this._bakedGroundContactShadowPass.parameters.enabled;
    if (
      limitPlaneSize !== this._bakedGroundContactShadowPass.limitPlaneSize ||
      this._bakedGroundContactShadowPass.needsUpdate
    ) {
      this._bakedGroundContactShadowPass.updateBounds(
        this._sceneRenderer.boundingVolume,
        this._sceneRenderer.groundLevel
      );
    }
    this._sceneRenderPass.drawGround =
      this._bakedGroundContactShadowPass.parameters.enabled ||
      this._shadowAndAoPass.parameters.applyToMaterial;
  }

  private _updateGBufferPass(
    updateRequirements: DynamicPassUpdateRequirements
  ) {
    this._passUpdateStates.updateGBuffer = false;
    this._gBufferRenderPass.needsUpdate =
      updateRequirements.needsUpdate ||
      updateRequirements.shadowOnCameraChange === SHADOW_BLUR_TYPES.POISSON;
    this.gBufferRenderPass.drawGround =
      this._sceneRenderer.boundingVolumeSet &&
      this._shadowAndAoPass.parameters.aoOnGround;
  }

  private _updateGroundReflectionPass(
    updateRequirements: DynamicPassUpdateRequirements
  ) {
    this._passUpdateStates.updateGroundReflection = false;
    if (
      this._groundReflectionPass.parameters.enabled &&
      this._dynamicChanges(updateRequirements) &&
      (!this.parameters.suspendGroundReflection ||
        updateRequirements.needsUpdate)
    ) {
      this._groundReflectionPass.reflectionFadeInScale = this.parameters
        .suspendGroundReflection
        ? updateRequirements.intensityScale
        : 1.0;
      this._passUpdateStates.updateGroundReflection = true;
    }
  }

  private _updateScreenSpaceShadowPass(
    updateRequirements: DynamicPassUpdateRequirements
  ) {
    if (!this._dynamicChanges(updateRequirements)) {
      this._passUpdateStates.updateScreenSpaceShadow = false;
      return;
    }
    this._screenSpaceShadowMapPass.parameters.alwaysUpdate =
      this._shadowAndAoPass.parameters.alwaysUpdate;
    this._screenSpaceShadowMapPass.drawGround =
      this._shadowAndAoPass.parameters.shadowOnGround;
    this._passUpdateStates.updateScreenSpaceShadow =
      this._shadowAndAoPass.parameters.shadowIntensity > 0;
    this._passUpdateStates.updateScreenSpaceShadow = true;
    this._passUpdateStates.updateGBuffer = true;
  }

  private _updateShadowAndAoPass(
    updateRequirements: DynamicPassUpdateRequirements
  ) {
    if (!this._dynamicChanges(updateRequirements)) {
      this._passUpdateStates.updateShadowAndAoPass = false;
      return;
    }
    this._shadowAndAoPass.shadowAndAoPassSettings = {
      shadowMapTexture: this._screenSpaceShadowMapPass.shadowTexture,
      shadowBlurType: updateRequirements.needsUpdate
        ? SHADOW_BLUR_TYPES.FULL
        : updateRequirements.shadowOnCameraChange,
      shadowFadeInBlurType: updateRequirements.shadowOnCameraChange,
      shadowFadeInMix: 1 - updateRequirements.intensityScale,
      noOStaticFrames: this.noOStaticFrames,
    };
    this._passUpdateStates.updateShadowAndAoPass = true;
    this._passUpdateStates.updateGBuffer = true;
  }

  private _updateOutlinePass() {
    if (
      !this.outlineRenderer.outlinePassActivated ||
      !this.outlineRenderer.outlinePass
    ) {
      this._passUpdateStates.updateOutlinePass = false;
      return;
    }
    this.outlineRenderer.outlinePass.renderToScreen = false;
    this.outlineRenderer.outlinePass.clearBackground = false;
    this._passUpdateStates.updateOutlinePass = true;
    this._passUpdateStates.updateGBuffer = true;
  }

  private _updateDebugPass() {
    if (
      !this.debugOutput ||
      this.debugOutput === '' ||
      this.debugOutput === 'off'
    ) {
      this._passUpdateStates.updateDebugPass = false;
      return;
    }
    if (this.debugOutput === 'outline' && this.outlineRenderer.outlinePass) {
      this.outlineRenderer.outlinePass.clearBackground = true;
      this._passUpdateStates.updateDebugPass = false;
      return;
    }
    if (this.debugOutput === 'color' || this.debugOutput === 'grayscale') {
      this._passUpdateStates.updateGroundReflection = false;
      this._passUpdateStates.updateGBuffer = false;
      this._passUpdateStates.updateScreenSpaceShadow = false;
      this._passUpdateStates.updateShadowAndAoPass = false;
      this._passUpdateStates.updateOutlinePass = false;
      this._passUpdateStates.updateDebugPass = false;
      this._sceneRenderPass.drawWithDebugMaterial =
        this.debugOutput === 'grayscale';
      return;
    }
    this.debugPass.debugOutput = this.debugOutput;
    this._passUpdateStates.updateDebugPass = true;
  }

  private _updateMaterials(renderer: WebGLRenderer, scene: Scene) {
    if (
      !this.materialsNeedUpdate ||
      !this._shadowAndAoPass.parameters.applyToMaterial
    ) {
      return;
    }
    this.aoPassMapTexture = this._shadowAndAoPass.denoiseRenderTargetTexture;
    const devicePixelRatio: number = renderer.getPixelRatio();
    this.materialsNeedUpdate = false;
    scene.traverse((object: Object3D) => {
      if ((object as ThreeObject3d).isMesh) {
        const material = (object as Mesh).material;
        if (material instanceof MeshStandardMaterial) {
          this._updateMaterial(object as Mesh, material, devicePixelRatio);
        }
      }
    });
  }

  private _updateMaterial(
    object: Mesh,
    material: MeshStandardMaterial,
    devicePixelRatio: number
  ) {
    const plugIn = PostProcessingMaterialPlugin.addPlugin(material);
    if (plugIn) {
      this._updatePlugInAo(plugIn, object, material, devicePixelRatio);
      this._updatePlugInReflection(plugIn, object);
      material.needsUpdate = false;
    }
  }

  private _updatePlugInAo(
    plugIn: PostProcessingMaterialPlugin,
    object: Mesh,
    material: MeshStandardMaterial,
    devicePixelRatio: number
  ) {
    const applyAoToMaterial =
      this._shadowAndAoPass.parameters.enabled &&
      this._shadowAndAoPass.parameters.applyToMaterial &&
      this.aoPassMapTexture !== null &&
      (material.name === 'ShadowGroundPlaneMaterial' ||
        (object.receiveShadow &&
          (!material.transparent || material.alphaTest >= 0.9)));
    const aoEnabled =
      applyAoToMaterial && this._shadowAndAoPass.parameters.aoIntensity > 0.01;
    const shadowEnabled =
      applyAoToMaterial &&
      this._screenSpaceShadowMapPass.enabled &&
      this._shadowAndAoPass.parameters.shadowIntensity > 0.01;
    plugIn.applyAoAndShadowToAlpha =
      material.name === 'ShadowGroundPlaneMaterial';
    plugIn.aoPassMapIntensity = aoEnabled
      ? this._shadowAndAoPass.parameters.aoIntensity * 2
      : -1.0;
    plugIn.shPassMapIntensity = shadowEnabled
      ? this._shadowAndAoPass.parameters.shadowIntensity * 2
      : -1.0;
    plugIn.aoPassMapScale = 1 / devicePixelRatio;
    plugIn.aoPassMap = this.aoPassMapTexture;
  }

  private _updatePlugInReflection(
    plugIn: PostProcessingMaterialPlugin,
    object: Mesh
  ) {
    const reflectionPassTexture =
      this._groundReflectionPass.intensityRenderTarget.texture;
    const isFloor = object.userData.isPlanFloor;
    const reflectionEnabled =
      isFloor &&
      this._groundReflectionPass.parameters.enabled &&
      (reflectionPassTexture !== null || reflectionPassTexture !== undefined);
    const intensity = this._groundReflectionPass.parameters.intensity;
    plugIn.applyReflectionPassMap = reflectionEnabled;
    plugIn.reflectionPassMapIntensity = reflectionEnabled
      ? Math.pow(intensity, 0.25)
      : 0;
    plugIn.reflectionPassMapScale =
      1 /
      (this._groundReflectionPass.parameters.renderTargetDownScale *
        devicePixelRatio);
    plugIn.reflectionPassMap = reflectionEnabled ? reflectionPassTexture : null;
  }

  public renderPasses(renderer: WebGLRenderer, scene: Scene): void {
    renderer.setRenderTarget(null);
    this._bakedGroundContactShadowPass.renderPass(renderer);
    if (this._passUpdateStates.updateGBuffer) {
      this._gBufferRenderPass.renderPass(renderer);
    }
    if (this._passUpdateStates.updateScreenSpaceShadow) {
      this._screenSpaceShadowMapPass.renderPass(renderer);
    }
    if (this._passUpdateStates.updateShadowAndAoPass) {
      this._shadowAndAoPass.renderPass(renderer);
    }
    this._updateMaterials(renderer, scene);
    this._sceneRenderPass.renderPass(renderer);
    if (this._passUpdateStates.updateGroundReflection) {
      this._groundReflectionPass.renderPass(renderer);
    }
    if (
      this._passUpdateStates.updateShadowAndAoPass &&
      !this._shadowAndAoPass.parameters.applyToMaterial
    ) {
      this._shadowAndAoPass.renderToTarget(renderer);
    }
    if (this._passUpdateStates.updateOutlinePass) {
      this._outlinePass?.renderPass(renderer);
    }
    if (this._passUpdateStates.updateDebugPass) {
      this._debugPass?.renderPass(renderer);
    }
  }
}
