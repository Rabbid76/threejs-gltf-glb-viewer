import type { SceneVolume } from './render-utility';
import { BlurPass } from './render-utility';
import { BlurShader } from './shader-utility';
import type { RenderCacheManager } from './render-cache';
import { VisibilityRenderCache } from './render-cache';
import type {
  Camera,
  Group,
  Layers,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three';
import {
  CameraHelper,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  OrthographicCamera,
  PlaneGeometry,
  WebGLRenderTarget,
} from 'three';

export interface BakedGroundContactShadowParameters {
  [key: string]: any;
  enabled: boolean;
  cameraHelper: boolean;
  alwaysUpdate: boolean;
  fadeIn: boolean;
  blurMin: number;
  blurMax: number;
  fadeoutFalloff: number;
  fadeoutBias: number;
  opacity: number;
  maximumPlaneSize: number;
  planeSize: number;
  cameraFar: number;
  hardLayers: Layers | null;
  softLayers: Layers | null;
  polygonOffset: number;
}

const castGroundContactShadow = (object: any): boolean => {
  if (!object.isMesh) {
    return false;
  }
  if (!object.castShadow && !object.userData?.meshId) {
    return false;
  }
  const material = object.material;
  return !material.transparent || material.opacity > 0.5;
};

export class BakedGroundContactShadow {
  public static addTestMesh: boolean = false;
  public shadowMapSize: number;
  public parameters: BakedGroundContactShadowParameters;
  private _renderer: WebGLRenderer;
  private _renderCacheManager?: RenderCacheManager;
  public needsUpdate: boolean = true;
  public noNeedOfUpdateCount = 0;
  private _blurScale: number = 1;
  private _shadowScale: number = 1;
  private _groundGroup: Group;
  private _groundShadowFar: number;
  public shadowGroundPlane: ShadowGroundPlane;
  private _groundContactCamera: GroundContactCamera;
  private _renderTargetBlur: WebGLRenderTarget;
  private _blurPass: BlurPass;
  public readonly renderTarget: WebGLRenderTarget;
  private _depthMaterial: MeshDepthMaterial;

  constructor(_renderer: WebGLRenderer, _groundGroup: Group, parameters: any) {
    this._groundGroup = _groundGroup;
    this.shadowMapSize = parameters.shadowMapSize ?? 2048;
    this.parameters = this._getDefaultParameters(parameters);
    this._groundShadowFar = this.parameters.cameraFar;
    this._renderer = _renderer;
    this._renderCacheManager = parameters?._renderCacheManager;
    if (this._renderCacheManager) {
      this._renderCacheManager.registerCache(
        this,
        new VisibilityRenderCache((object: any) => {
          return (
            (object.isMesh && !castGroundContactShadow(object)) ||
            (object.name !== undefined &&
              ['Ground', 'Floor'].includes(object.name))
          );
        }),
      );
    }
    this.renderTarget = new WebGLRenderTarget(
      this.shadowMapSize,
      this.shadowMapSize,
    );
    this.renderTarget.texture.generateMipmaps = false;
    //this.renderTarget.depthTexture = new DepthTexture(this.shadowMapSize, this.shadowMapSize);
    //this.renderTarget.depthTexture.generateMipmaps = false;
    this._renderTargetBlur = new WebGLRenderTarget(
      this.shadowMapSize,
      this.shadowMapSize,
    );
    this._renderTargetBlur.texture.generateMipmaps = false;

    this.shadowGroundPlane = new ShadowGroundPlane(
      this.renderTarget.texture,
      this.parameters,
    );
    this._groundGroup.add(this.shadowGroundPlane);

    this._groundContactCamera = new GroundContactCamera();
    this._groundGroup.add(this._groundContactCamera);

    this._depthMaterial = new MeshDepthMaterial();
    this._depthMaterial.userData.fadeoutBias = {
      value: this.parameters.fadeoutBias,
    };
    this._depthMaterial.userData.fadeoutFalloff = {
      value: this.parameters.fadeoutFalloff,
    };
    this._depthMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.fadeoutBias = this._depthMaterial.userData.fadeoutBias;
      shader.uniforms.fadeoutFalloff =
        this._depthMaterial.userData.fadeoutFalloff;
      shader.fragmentShader = `
              uniform float fadeoutBias;
              uniform float fadeoutFalloff;
              ${shader.fragmentShader.replace(
                'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
                ShadowGroundPlane.alphaMap
                  ? 'gl_FragColor = vec4(clamp(pow(1.0 + fadeoutBias - fragCoordZ, 1.0/(1.0-fadeoutFalloff)), 0.0, 1.0));'
                  : 'gl_FragColor = vec4(vec3(0.0), clamp(pow(1.0 + fadeoutBias - fragCoordZ, 1.0/(1.0-fadeoutFalloff)), 0.0, 1.0));',
              )}
          `;
    };
    this._depthMaterial.side = DoubleSide;
    this._depthMaterial.depthTest = true;
    this._depthMaterial.depthWrite = true;
    this._blurPass = new BlurPass(BlurShader, parameters);
    this.updatePlaneAndShadowCamera();
  }

  // eslint-disable-next-line complexity
  private _getDefaultParameters(parameters: any) {
    return {
      enabled: true,
      cameraHelper: false,
      alwaysUpdate: false,
      fadeIn: false,
      blurMin: 0.001,
      blurMax: 0.1,
      fadeoutFalloff: 0.9,
      fadeoutBias: 0.03,
      opacity: 0.5,
      maximumPlaneSize: 20,
      planeSize: 10,
      cameraFar: 3,
      hardLayers: null,
      softLayers: null,
      polygonOffset: 2,
      excludeGroundObjects: true,
      ...parameters,
    };
  }

  public dispose() {
    this.renderTarget.dispose();
    this._renderTargetBlur.dispose();
    this._blurPass.dispose();
    this._depthMaterial.dispose();
  }

  public updateParameters(parameters: any) {
    for (let propertyName in parameters) {
      if (this.parameters.hasOwnProperty(propertyName)) {
        this.parameters[propertyName] = parameters[propertyName];
      }
    }
    if (parameters.cameraFar !== undefined) {
      this._groundShadowFar = this.parameters.cameraFar;
    }
  }

  public applyParameters() {
    this.shadowGroundPlane.updateMaterial(this.parameters);
    this._groundContactCamera.updateCameraHelper(this.parameters.cameraHelper);
    if (this._groundContactCamera.far !== this.parameters.cameraFar) {
      this.updatePlaneAndShadowCamera();
    }
    const fadeoutFalloff = this.parameters.fadeoutFalloff;
    if (this._depthMaterial.userData.fadeoutFalloff.value !== fadeoutFalloff) {
      this._depthMaterial.userData.fadeoutFalloff.value =
        this.parameters.fadeoutFalloff;
    }
    const fadeoutBias =
      this.parameters.fadeoutBias / this._groundContactCamera.far;
    if (this._depthMaterial.userData.fadeoutBias.value !== fadeoutBias) {
      this._depthMaterial.userData.fadeoutBias.value = fadeoutBias;
    }
    this.needsUpdate = true;
  }

  public setScale(groundContactShadowScale: number, _shadowScale?: number) {
    this._blurScale = groundContactShadowScale;
    this._shadowScale = _shadowScale ?? groundContactShadowScale;
    this.needsUpdate = true;
  }

  public updateBounds(sceneBounds: SceneVolume, groundLevel?: number) {
    this._groundShadowFar = this.parameters.cameraFar;
    if (this._groundShadowFar < sceneBounds.size.z) {
      this._groundShadowFar = sceneBounds.size.z * 1.01;
    }
    const maxPlanSideLength = Math.max(sceneBounds.size.x, sceneBounds.size.z);
    this.parameters.planeSize =
      maxPlanSideLength +
      2 * Math.max(this._blurScale, this._shadowScale ?? 1, 1);
    if (this.parameters.planeSize > this.parameters.maximumPlaneSize) {
      this.parameters.planeSize = this.parameters.maximumPlaneSize;
      this._groundGroup.position.set(0, groundLevel ?? 0, 0);
    } else {
      this._groundGroup.position.set(
        sceneBounds.center.x,
        groundLevel ?? 0,
        sceneBounds.center.z,
      );
    }
    this._groundGroup.updateMatrixWorld();
    this.updatePlaneAndShadowCamera();
  }

  public updatePlaneAndShadowCamera() {
    const size = this.parameters.planeSize;
    this.shadowGroundPlane.scale.x = size;
    this.shadowGroundPlane.scale.y = size;
    this._groundContactCamera.updateCameraFormPlaneSize(
      size,
      this._groundShadowFar,
    );
    this.needsUpdate = true;
  }

  public setGroundVisibility(visible: boolean, _camera?: Camera) {
    this.shadowGroundPlane.updateVisibility(visible);
  }

  public render(scene: Scene): void {
    this._groundContactCamera.updateCameraHelper(
      this.parameters.cameraHelper,
      scene,
    );
    const maxIterations = 10;
    this.shadowGroundPlane.visible = this.parameters.enabled;
    const needsUpdate = this.parameters.alwaysUpdate || this.needsUpdate;
    if (!needsUpdate) {
      this.noNeedOfUpdateCount++;
      if (this.noNeedOfUpdateCount >= maxIterations) {
        return;
      }
    } else {
      this.noNeedOfUpdateCount = 0;
    }
    this.needsUpdate = false;

    const shadowGroundMaterial = this.shadowGroundPlane
      .material as MeshBasicMaterial;
    shadowGroundMaterial.opacity =
      this.parameters.alwaysUpdate || !this.parameters.fadeIn
        ? this.parameters.opacity
        : (this.parameters.opacity * (this.noNeedOfUpdateCount + 2)) /
          (maxIterations + 2);

    const initialClearAlpha = this._renderer.getClearAlpha();
    this._renderer.setClearAlpha(0);
    this._groundGroup.visible = false;
    this.shadowGroundPlane.visible = false;
    this._groundContactCamera.setCameraHelperVisibility(false);

    if (this.noNeedOfUpdateCount === 0) {
      this._renderGroundContact(scene);
      this._renderBlur();
    } else if (this.noNeedOfUpdateCount === 1) {
      this._renderBlur();
    }
    this._renderReduceBandingBlur();

    this._renderer.setRenderTarget(null);
    this._renderer.setClearAlpha(initialClearAlpha);
    this._groundGroup.visible = true;
    this.shadowGroundPlane.visible = this.parameters.enabled;
    this._groundContactCamera.setCameraHelperVisibility(
      this.parameters.cameraHelper,
    );
  }

  private _renderGroundContact(scene: Scene) {
    const initialBackground = scene.background;
    scene.background = null;
    scene.overrideMaterial = this._depthMaterial;
    this._renderer.setRenderTarget(this.renderTarget);
    this._renderer.clear();
    const autoClearBackup = this._renderer.autoClear;
    this._renderer.autoClear = false;
    if (this.parameters.hardLayers) {
      this._groundContactCamera.layers.mask = this.parameters.hardLayers.mask;
      this._groundContactCamera.updateCameraFarPlane(10);
      this._depthMaterial.userData.fadeoutBias.value = 0.99;
      this._renderer.render(scene, this._groundContactCamera);
      this._groundContactCamera.updateCameraFarPlane(this._groundShadowFar);
      this._depthMaterial.userData.fadeoutBias.value =
        this.parameters.fadeoutBias / this._groundShadowFar;
    }
    this._groundContactCamera.layers.enableAll();
    if (this.parameters.softLayers) {
      this._groundContactCamera.layers.mask = this.parameters.softLayers.mask;
    }
    if (this._renderCacheManager) {
      this._renderCacheManager.render(this, scene, () => {
        this._renderer.render(scene, this._groundContactCamera);
      });
    } else {
      this._renderer.render(scene, this._groundContactCamera);
    }
    this._renderer.autoClear = autoClearBackup;
    scene.overrideMaterial = null;
    scene.background = initialBackground;
  }

  private _renderBlur() {
    this._renderBlurPass(
      (this._blurScale * this.parameters.blurMin) / this.parameters.planeSize,
      (this._blurScale * this.parameters.blurMax) / this.parameters.planeSize,
    );
  }

  private _renderReduceBandingBlur() {
    const finalBlurAmount =
      (this._blurScale * 0.01) / this.parameters.planeSize;
    this._renderBlurPass(finalBlurAmount, finalBlurAmount);
  }

  private _renderBlurPass(uvMin: number, uvMax: number): void {
    this._blurPass.render(
      this._renderer,
      [this.renderTarget, this._renderTargetBlur, this.renderTarget],
      [uvMin, uvMin],
      [uvMax, uvMax],
    );
  }
}

export class ShadowGroundPlane extends Mesh {
  public static alphaMap: boolean = false;

  constructor(shadowMap: Texture | null, parameters?: any) {
    const planeMaterial = new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      //side: DoubleSide
    });
    if (ShadowGroundPlane.alphaMap) {
      planeMaterial.color.set(0x000000);
    }
    planeMaterial.polygonOffset = true;
    super(new PlaneGeometry(1, 1, 10, 10), planeMaterial);
    this.name = 'GroundContactShadowPlane';
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
    if (this.visible) {
      this.layers.enableAll();
    } else {
      this.layers.disableAll();
    }
  }

  public setDepthWrite(write: boolean) {
    const shadowGroundMaterial = this.material as MeshBasicMaterial;
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
    const shadowGroundMaterial = this.material as MeshBasicMaterial;
    shadowGroundMaterial.map = shadowMap;
    if (ShadowGroundPlane.alphaMap) {
      shadowGroundMaterial.alphaMap = shadowMap;
    }
    shadowGroundMaterial.needsUpdate = true;
  }

  public updateMaterial(parameters: any) {
    const shadowGroundMaterial = this.material as MeshBasicMaterial;
    if (shadowGroundMaterial.opacity !== parameters.opacity) {
      shadowGroundMaterial.opacity = parameters.opacity;
    }
    if (shadowGroundMaterial.polygonOffsetFactor !== parameters.polygonOffset) {
      shadowGroundMaterial.polygonOffset = true;
      shadowGroundMaterial.polygonOffsetFactor = parameters.polygonOffset;
      shadowGroundMaterial.polygonOffsetUnits = parameters.polygonOffset;
    }
  }

  public updateVisibility(visible: boolean) {
    if (visible) {
      this.layers.enableAll();
    } else {
      this.layers.disableAll();
    }
  }
}

class GroundContactCamera extends OrthographicCamera {
  private cameraHelper?: CameraHelper;

  constructor() {
    super(-1, 1, -1, 1, -1, 1);
    this.rotation.x = Math.PI; // make camera look upwards
  }

  public updateCameraFormPlaneSize(planeSize: number, farPlane: number) {
    this.left = -planeSize / 2;
    this.right = planeSize / 2;
    this.top = -planeSize / 2;
    this.bottom = planeSize / 2;
    this.near = 0;
    this.far = farPlane;
    this.updateProjectionMatrix();
    this.cameraHelper?.update();
  }

  public updateCameraFarPlane(farPlane: number) {
    this.far = farPlane;
    this.updateProjectionMatrix();
    this.cameraHelper?.update();
  }

  public updateCameraHelper(enabled: boolean, scene?: Scene) {
    if (enabled) {
      this.cameraHelper = this.cameraHelper ?? new CameraHelper(this);
      this.cameraHelper.visible = true;
      scene?.add(this.cameraHelper);
    } else if (this.cameraHelper?.parent) {
      this.cameraHelper?.removeFromParent();
    }
  }

  public setCameraHelperVisibility(visible: boolean) {
    if (this.cameraHelper) {
      this.cameraHelper.visible = visible;
    }
  }
}
