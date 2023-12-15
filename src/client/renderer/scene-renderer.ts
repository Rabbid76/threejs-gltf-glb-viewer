import {
  CameraUpdate,
  getMaxSamples,
  RenderPass,
  SceneVolume,
} from './render-utility';
import type { CopyTransformMaterial } from './shader-utility';
import type { GBufferParameters } from './gbuffer-render-target';
import { GBufferRenderTargets } from './gbuffer-render-target';
import { ShadowGroundPlane } from './objects/shadow-ground-plane';
import type { BakedGroundContactShadowParameters } from './baked-ground-contact-shadow';
import { BakedGroundContactShadow } from './baked-ground-contact-shadow';
import type { OutlineParameters } from './outline-renderer';
import { OutLineRenderer } from './outline-renderer';
import type { ScreenSpaceShadowMapParameters } from './screen-space-shadow-map';
import { ScreenSpaceShadowMap } from './screen-space-shadow-map';
import type { ShadowAndAoPassParameters } from './shadow-and-ao-pass';
import { ShadowAndAoPass, ShadowBlurType } from './shadow-and-ao-pass';
import type { GroundReflectionParameters } from './ground-reflection-pass';
import { GroundReflectionPass } from './ground-reflection-pass';
import type { LightSource } from './light-source-detection';
import {
  DepthWriteRenderCache,
  RenderCacheManager,
  VisibilityRenderCache,
} from './render-cache';
import { DebugPass } from './scene-renderer-debug';
import type {
  Box3,
  Camera,
  Mesh,
  Object3D,
  PerspectiveCamera,
  RectAreaLight,
  Scene,
  WebGLRenderer,
} from 'three';
import { Color, Group, Vector2 } from 'three';

export { BakedGroundContactShadowParameters } from './baked-ground-contact-shadow';
export { OutlineParameters } from './outline-renderer';
export {
  ShadowParameters,
  ShadowAndAoPassParameters,
} from './shadow-and-ao-pass';
export { AORenderPassParameters } from './pass/ao-pass';
export { GroundReflectionParameters } from './ground-reflection-pass';

interface WithUserData {
  userData?: Record<string, any>;
}

export enum QualityLevel {
  HIGHEST,
  HIGH,
  MEDIUM,
  LOW,
}
export type QualityMap = Map<QualityLevel, any>;

export interface SceneRendererParameters {
  gBufferRenderTargetParameters: GBufferParameters;
  shAndAoPassParameters: ShadowAndAoPassParameters;
  screenSpaceShadowMapParameters: ScreenSpaceShadowMapParameters;
  groundReflectionParameters: GroundReflectionParameters;
  bakedGroundContactShadowParameters: BakedGroundContactShadowParameters;
  outlineParameters: OutlineParameters;
  effectSuspendFrames: number;
  effectFadeInFrames: number;
  suspendGroundReflection: boolean;
  shadowOnCameraChange: ShadowBlurType;
}

export class SceneRenderer {
  public parameters: SceneRendererParameters;
  public debugOutput = 'off';
  private _prevDebugOutput = 'off';
  public outputColorSpace = '';
  public toneMapping = '';
  public environmentLights = false;
  public movingCamera: boolean = false;
  public groundLevel: number = 0;
  public uiInteractionMode: boolean = false;
  private _noUpdateNeededCount = 0;
  private _noOStaticFrames = 0;
  private _cameraUpdate: CameraUpdate = new CameraUpdate();
  public renderer: WebGLRenderer;
  public width: number = 0;
  public height: number = 0;
  private _maxSamples: number = 1;
  private _cameraChanged: boolean = true;
  public boundingVolume = new SceneVolume();
  private _boundingVolumeSet: boolean = false;
  public renderCacheManager: RenderCacheManager = new RenderCacheManager();
  private _renderPass: RenderPass = new RenderPass();
  private _shadowAndAoGroundPlane: ShadowGroundPlane;
  public shadowAndAoPass: ShadowAndAoPass;
  public screenSpaceShadow: ScreenSpaceShadowMap;
  public groundReflectionPass: GroundReflectionPass;
  public gBufferRenderTarget: GBufferRenderTargets;
  public bakedGroundContactShadow: BakedGroundContactShadow;
  public outlineRenderer: OutLineRenderer;
  public selectedObjects: Object3D[] = [];
  private _copyMaterial?: CopyTransformMaterial;
  public readonly groundGroup: Group = new Group();
  private _debugPass?: DebugPass;
  private _qualityLevel: QualityLevel = QualityLevel.HIGHEST;
  private _qualityMap: QualityMap = new Map<QualityLevel, any>();

  public constructor(renderer: WebGLRenderer, width: number, height: number) {
    this.width = width;
    this.height = height;
    this._maxSamples = getMaxSamples(renderer);
    this.renderer = renderer;
    this.renderCacheManager.registerCache(
      'inivisibleGround',
      new VisibilityRenderCache((object: any) => {
        return object === this.groundGroup;
      })
    );
    this.renderCacheManager.registerCache('debug', new VisibilityRenderCache());
    this.renderCacheManager.registerCache(
      'floorDepthWrite',
      new DepthWriteRenderCache((mesh: Mesh) => {
        return mesh.userData?.isFloor;
      })
    );
    const gBufferAndAoSamples = 1;
    this.gBufferRenderTarget = new GBufferRenderTargets(
      this.renderCacheManager,
      {
        shared: true,
        capabilities: renderer.capabilities,
        width: this.width,
        height: this.height,
        samples: gBufferAndAoSamples,
        renderPass: this._renderPass,
      }
    );
    this.shadowAndAoPass = new ShadowAndAoPass(
      this.width,
      this.height,
      gBufferAndAoSamples,
      {
        gBufferRenderTarget: this.gBufferRenderTarget,
      }
    );
    this.screenSpaceShadow = new ScreenSpaceShadowMap(
      this.renderCacheManager,
      new Vector2(this.width, this.height),
      {
        samples: this._maxSamples,
        alwaysUpdate: false,
      }
    );
    this.groundReflectionPass = new GroundReflectionPass(
      this.width,
      this.height,
      {
        renderPass: this._renderPass,
      }
    );
    this._shadowAndAoGroundPlane = new ShadowGroundPlane(null);
    this.bakedGroundContactShadow = new BakedGroundContactShadow(
      this.renderer,
      this.groundGroup,
      {
        renderPass: this._renderPass,
        renderCacheManager: this.renderCacheManager,
        sharedShadowGroundPlane: this._shadowAndAoGroundPlane,
      }
    );
    this.groundGroup.rotateX(-Math.PI / 2);
    this.outlineRenderer = new OutLineRenderer(null, this.width, this.height, {
      gBufferRenderTarget: this.gBufferRenderTarget,
    });
    this.parameters = {
      gBufferRenderTargetParameters: this.gBufferRenderTarget.parameters,
      bakedGroundContactShadowParameters:
        this.bakedGroundContactShadow.parameters,
      screenSpaceShadowMapParameters: this.screenSpaceShadow.parameters,
      shAndAoPassParameters: this.shadowAndAoPass.parameters,
      groundReflectionParameters: this.groundReflectionPass.parameters,
      outlineParameters: this.outlineRenderer.parameters,
      effectSuspendFrames: 0,
      effectFadeInFrames: 0,
      suspendGroundReflection: false,
      shadowOnCameraChange: ShadowBlurType.OFF,
    };
    this._addEventListeners(this.renderer);
  }

  private _addEventListeners(renderer: WebGLRenderer) {
    renderer.domElement.addEventListener('webglcontextlost', () => {
      console.log('webglcontextlost');
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      console.log('webglcontextrestored');
      this._forceEnvironmentMapUpdate(this.renderer);
    });
  }

  public dispose(): void {
    this._debugPass?.dispose();
    this._copyMaterial?.dispose();
    this.gBufferRenderTarget.dispose();
    this.screenSpaceShadow.dispose();
    this.shadowAndAoPass.dispose();
    this.outlineRenderer.dispose();
    this.renderer.dispose();
  }

  public setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.gBufferRenderTarget.setSize(width, height);
    this.screenSpaceShadow.setSize(width, height);
    this.shadowAndAoPass.setSize(width, height);
    this.outlineRenderer.setSize(width, height);
    this.groundReflectionPass.setSize(width, height);
    this.renderer.setSize(width, height);
  }

  public getQualityLevel() {
    return this._qualityLevel;
  }

  public setQualityLevel(_qualityLevel: QualityLevel): void {
    if (this._qualityLevel === _qualityLevel) {
      return;
    }
    if (this._qualityMap.has(this._qualityLevel)) {
      this._qualityLevel = _qualityLevel;
    }
    this.applyCurrentParameters();
  }

  public setQualityMap(_qualityMap: QualityMap) {
    this._qualityMap = _qualityMap;
    this.applyCurrentParameters();
  }

  public applyCurrentParameters() {
    if (this._qualityMap.has(this._qualityLevel)) {
      this.updateParameters(this._qualityMap.get(this._qualityLevel));
      this.bakedGroundContactShadow.applyParameters();
    }
    if (this.uiInteractionMode) {
      this.updateParameters({
        groundReflectionParameters: {
          enabled: false,
        },
      });
    }
  }

  public clearCache() {
    this.renderCacheManager.clearCache();
  }

  public forceShadowUpdates(updateBakedGroundShadow: boolean): void {
    this.clearCache();
    this.gBufferRenderTarget.needsUpdate = true;
    this.screenSpaceShadow.forceShadowUpdate();
    this.shadowAndAoPass.needsUpdate = true;
    if (updateBakedGroundShadow) {
      this.bakedGroundContactShadow.needsUpdate = true;
    }
  }

  public updateParameters(parameters: any) {
    if (parameters.shAndAoPassParameters !== undefined) {
      this.shadowAndAoPass.updateParameters(parameters.shAndAoPassParameters);
    }
    if (parameters.bakedGroundContactShadowParameters !== undefined) {
      this.bakedGroundContactShadow.updateParameters(
        parameters.bakedGroundContactShadowParameters
      );
    }
    if (parameters.screenSpaceShadowMapParameters !== undefined) {
      this.screenSpaceShadow.updateParameters(
        parameters.screenSpaceShadowMapParameters
      );
    }
    if (parameters.groundReflectionParameters !== undefined) {
      this.groundReflectionPass.updateParameters(
        parameters.groundReflectionParameters
      );
    }
    if (parameters.outlineParameters !== undefined) {
      this.outlineRenderer.updateParameters(parameters.outlineParameters);
    }
    if (parameters.effectSuspendFrames !== undefined) {
      this.parameters.effectSuspendFrames = parameters.effectSuspendFrames;
    }
    if (parameters.effectFadeInFrames !== undefined) {
      this.parameters.effectFadeInFrames = parameters.effectFadeInFrames;
    }
    if (parameters.suspendGroundReflection !== undefined) {
      this.parameters.suspendGroundReflection =
        parameters.suspendGroundReflection;
    }
    if (parameters.shadowOnCameraChange !== undefined) {
      this.parameters.shadowOnCameraChange = parameters.shadowOnCameraChange;
    }
  }

  public addRectAreaLight(
    rectAreaLight: RectAreaLight,
    parent: Object3D
  ): void {
    this.environmentLights = false;
    this.screenSpaceShadow.addRectAreaLight(rectAreaLight, parent);
    this.shadowAndAoPass.needsUpdate = true;
  }

  public updateRectAreaLights(
    rectAreaLights: RectAreaLight[],
    parent: Object3D
  ): void {
    if (rectAreaLights.length > 0) {
      this.environmentLights = false;
    }
    this.screenSpaceShadow.updateRectAreaLights(rectAreaLights, parent);
    this.shadowAndAoPass.needsUpdate = true;
  }

  public createShadowFromLightSources(
    parent: Object3D,
    lightSources: LightSource[]
  ): void {
    this.environmentLights = true;
    this.screenSpaceShadow.createShadowFromLightSources(parent, lightSources);
    this.shadowAndAoPass.needsUpdate = true;
  }

  public selectObjects(selectedObjects: Object3D[]) {
    this.selectedObjects = selectedObjects;
  }

  public updateBounds(bounds: Box3, scaleShadowAndAo: boolean) {
    this.clearCache();
    this._boundingVolumeSet = true;
    this.gBufferRenderTarget.groundDepthWrite =
      this.shadowAndAoPass.parameters.aoOnGround;
    this.boundingVolume.updateFromBox(bounds);
    const size = this.boundingVolume.size;
    const shadowAndAoScale = (size.x + size.y + size.z) / 3;
    const minBoundsSize = Math.min(size.x, size.y, size.z);
    const maxBoundsSize = Math.max(size.x, size.y, size.z);
    const defaultScale =
      minBoundsSize < 0.5 ? minBoundsSize / 0.5 : size.z > 5 ? size.z / 5 : 1;
    this.bakedGroundContactShadow.setScale(
      scaleShadowAndAo ? shadowAndAoScale : defaultScale,
      shadowAndAoScale
    );
    this.groundReflectionPass.updateBounds(
      this.groundLevel,
      Math.min(1, maxBoundsSize)
    );
    this.screenSpaceShadow.updateBounds(this.boundingVolume, shadowAndAoScale);
    this.shadowAndAoPass.updateBounds(
      this.boundingVolume,
      scaleShadowAndAo ? shadowAndAoScale : Math.min(1, maxBoundsSize * 2)
    );
  }

  public updateNearAndFarPlaneOfPerspectiveCamera(
    camera: PerspectiveCamera,
    minimumFar?: number
  ) {
    // bring the near and far plane as close as possible to geometry
    // this is very likely the most important part for a glitch free and nice SSAO
    const nearFar = this.boundingVolume.getNearAndFarForPerspectiveCamera(
      camera.position,
      3
    );
    camera.near = Math.max(0.00001, nearFar[0] * 0.9);
    camera.far = Math.max(minimumFar ?? camera.near, nearFar[1]);
    camera.updateProjectionMatrix();
  }

  private _setRenderState(scene: Scene, camera: Camera) {
    const debugModeChanged: boolean =
      this.debugOutput !== this._prevDebugOutput;
    this._prevDebugOutput = this.debugOutput;
    this.screenSpaceShadow.parameters.alwaysUpdate =
      this.shadowAndAoPass.parameters.alwaysUpdate;
    this._cameraChanged = this._cameraUpdate.changed(camera);
    this.gBufferRenderTarget.needsUpdate ||=
      this._cameraChanged || debugModeChanged;
  }

  private _forceEnvironmentMapUpdate(renderer: WebGLRenderer) {
    const rendererUserData = (renderer as WithUserData).userData;
    if (rendererUserData?.environmentTexture) {
      const environmentTexture = rendererUserData.environmentTexture;
      rendererUserData.environmentTexture = undefined;
      environmentTexture.dispose();
    }
  }

  private _updateEnvironment(renderer: WebGLRenderer, scene: Scene) {
    if (!scene.userData?.environmentDefinition) {
      return;
    }
    if (!(renderer as WithUserData).userData) {
      (renderer as WithUserData).userData = {};
    }
    const rendererUserData = (renderer as WithUserData).userData;
    if (
      rendererUserData &&
      (scene.userData?.environmentDefinition.needsUpdate ||
        !rendererUserData.environmentTexture ||
        rendererUserData.environmentDefinition !==
          scene.userData.environmentDefinition)
    ) {
      const environmentDefinition = scene.userData.environmentDefinition;
      rendererUserData.environmentDefinition = environmentDefinition;
      rendererUserData.environmentTexture =
        environmentDefinition.createNewEnvironment(renderer);
      if (scene.userData.shadowFromEnvironment) {
        const maxNoOfLightSources = environmentDefinition.maxNoOfLightSources;
        if (maxNoOfLightSources !== undefined) {
          this.screenSpaceShadow.parameters.maximumNumberOfLightSources =
            maxNoOfLightSources;
        }
        this.createShadowFromLightSources(
          scene,
          environmentDefinition.lightSources
        );
      }
    }
    scene.environment = rendererUserData?.environmentTexture;
    if (scene.userData.showEnvironmentBackground) {
      scene.background = scene.environment;
    } else if (scene.background === scene.environment) {
      scene.background = null;
    }
  }

  private _setGroundVisibility(visible: boolean): void {
    this._shadowAndAoGroundPlane.setVisibility(visible);
  }

  public render(scene: Scene, camera: Camera): void {
    scene.add(this.groundGroup);
    this._setRenderState(scene, camera);
    this._updateEnvironment(this.renderer, scene);
    this.outlineRenderer.updateOutline(
      scene,
      camera,
      this.movingCamera ? [] : this.selectedObjects
    );
    this.renderer.setRenderTarget(null);
    if (
      this.debugOutput &&
      this.debugOutput !== '' &&
      this.debugOutput !== 'off'
    ) {
      this._renderDebug(this.renderer, scene, camera);
    } else {
      this.renderPreRenderPasses(this.renderer, scene, camera);
      this._renderScene(this.renderer, scene, camera);
      this.renderPostProcessingEffects(this.renderer, scene, camera);
    }
    scene.remove(this.groundGroup);
  }

  private _renderDebug(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    this._debugPass = this._debugPass ?? new DebugPass(this);
    this._debugPass.render(
      (r: WebGLRenderer, s: Scene, c: Camera) =>
        this.renderPreRenderPasses(r, s, c),
      (r: WebGLRenderer, s: Scene, c: Camera) => this._renderScene(r, s, c),
      (r: WebGLRenderer, s: Scene, c: Camera) =>
        this.renderPostProcessingEffects(r, s, c),
      renderer,
      scene,
      camera,
      this.debugOutput
    );
  }

  public renderPreRenderPasses(
    _renderer: WebGLRenderer,
    scene: Scene,
    _camera: Camera
  ): void {
    this._renderGroundContactShadow(scene);
  }

  private _renderScene(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    this.renderCacheManager.onBeforeRender('floorDepthWrite', scene);
    this._setGroundVisibility(this.bakedGroundContactShadow.parameters.enabled);
    renderer.render(scene, camera);
    this._setGroundVisibility(false);
    this.renderCacheManager.onAfterRender('floorDepthWrite');
  }

  public renderPostProcessingEffects(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera
  ): void {
    this.renderShadowAndAo(renderer, scene, camera);
    this._renderOutline();
  }

  private _renderGroundContactShadow(scene: Scene) {
    if (this.bakedGroundContactShadow.needsUpdate) {
      this.bakedGroundContactShadow.updateBounds(
        this.boundingVolume,
        this.groundLevel
      );
    }
    this.bakedGroundContactShadow.render(scene);
  }

  private renderShadowAndAo(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera
  ): void {
    const update = this._evaluateIfShadowAndAoUpdateIsNeeded(camera);
    if (
      update.needsUpdate ||
      update.shadowOnCameraChange !== ShadowBlurType.OFF
    ) {
      if (!this.parameters.suspendGroundReflection || update.needsUpdate) {
        const fadeInScale = this.parameters.suspendGroundReflection
          ? update.intensityScale
          : 1.0;
        this._renderGroundReflection(renderer, scene, camera, fadeInScale);
      }
      this.gBufferRenderTarget.needsUpdate =
        update.needsUpdate ||
        update.shadowOnCameraChange === ShadowBlurType.POISSON;
      this._setGroundVisibility(
        this._boundingVolumeSet && this.shadowAndAoPass.parameters.aoOnGround
      );
      this.gBufferRenderTarget.render(renderer, scene, camera);
      this._setGroundVisibility(false);
      if (this.shadowAndAoPass.parameters.shadowIntensity > 0) {
        this._setGroundVisibility(
          this.shadowAndAoPass.parameters.shadowOnGround
        );
        this.screenSpaceShadow.renderShadowMap(renderer, scene, camera);
        this._setGroundVisibility(false);
      }
      this.shadowAndAoPass.render(
        renderer,
        scene,
        camera,
        this.screenSpaceShadow.shadowTexture,
        update.needsUpdate ? ShadowBlurType.FULL : update.shadowOnCameraChange,
        update.shadowOnCameraChange,
        1 - update.intensityScale,
        this._noOStaticFrames
      );
    }
  }

  private _evaluateIfShadowAndAoUpdateIsNeeded(_camera: Camera) {
    const updateNow =
      this.shadowAndAoPass.parameters.alwaysUpdate ||
      this.screenSpaceShadow.needsUpdate ||
      this.screenSpaceShadow.shadowTypeNeedsUpdate;
    let needsUpdate =
      (this.shadowAndAoPass.parameters.enabled ||
        this.groundReflectionPass.parameters.enabled) &&
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
        : ShadowBlurType.OFF;
    return { needsUpdate, shadowOnCameraChange, intensityScale };
  }

  private _renderGroundReflection(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    reflectionFadeInScale: number = 1
  ): void {
    if (!this.groundReflectionPass.parameters.enabled) {
      return;
    }
    this.renderCacheManager.render('inivisibleGround', scene, () => {
      this.groundReflectionPass.render(
        renderer,
        scene,
        camera,
        reflectionFadeInScale
      );
    });
  }

  private _renderOutline() {
    if (
      this.outlineRenderer.outlinePassActivated &&
      this.outlineRenderer.outlinePass
    ) {
      const clearColor = this.renderer.getClearColor(new Color());
      const clearAlpha = this.renderer.getClearAlpha();
      if (this.debugOutput === 'outline') {
        this.renderer.setClearColor(0x000000, 0xff);
        this.renderer.clear(true, false, false);
      }
      this.outlineRenderer.outlinePass.renderToScreen = false;
      this.outlineRenderer.outlinePass.render(
        this.renderer,
        null,
        null,
        0,
        false
      );
      if (this.debugOutput === 'outline') {
        this.renderer.setClearColor(clearColor, clearAlpha);
      }
    }
  }
}
