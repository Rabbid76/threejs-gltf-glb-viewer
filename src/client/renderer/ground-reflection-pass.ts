import { BlurPass, RenderPass } from './render-utility';
import {
  BlurShader,
  CopyTransformMaterial,
  FLIP_Y_UV_TRANSFORM,
} from './shader-utility';
import type {
  Camera,
  OrthographicCamera,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three';
import {
  DepthTexture,
  DepthStencilFormat,
  Matrix4,
  NearestFilter,
  NoBlending,
  PerspectiveCamera,
  RGBAFormat,
  ShaderMaterial,
  UniformsUtils,
  UnsignedInt248Type,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';

interface CameraOffsets {
  _offset: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

export interface GroundReflectionParameters {
  [key: string]: any;
  enabled: boolean;
  intensity: number;
  fadeOutDistance: number;
  fadeOutExponent: number;
  brightness: number;
  blurHorizontal: number;
  blurVertical: number;
  blurAscent: number;
  groundLevel: number;
  groundReflectionScale: number;
  renderTargetDownScale: number;
}

export interface GroundReflectionConstructorParameters {
  renderPass?: RenderPass;
  enabled?: boolean;
  intensity?: number;
  fadeOutDistance?: number;
  fadeOutExponent?: number;
  brightness?: number;
  blurHorizontal?: number;
  blurVertical?: number;
  blurAscent?: number;
  groundLevel?: number;
  groundReflectionScale?: number;
  renderTargetDownScale?: number;
}

export class GroundReflectionPass {
  private _width: number;
  private _height: number;
  public parameters: GroundReflectionParameters;
  private _reflectionRenderTarget?: WebGLRenderTarget;
  private _intensityRenderTarget?: WebGLRenderTarget;
  private _blurRenderTarget?: WebGLRenderTarget;
  private _renderPass: RenderPass;
  private _blurPass: BlurPass;
  private _reflectionIntensityMaterial: GroundReflectionIntensityMaterial;
  private _copyMaterial: CopyTransformMaterial;

  public get reflectionRenderTarget(): WebGLRenderTarget {
    this._reflectionRenderTarget =
      this._reflectionRenderTarget ?? this._newRenderTarget(true);
    return this._reflectionRenderTarget;
  }

  public get intensityRenderTarget(): WebGLRenderTarget {
    this._intensityRenderTarget =
      this._intensityRenderTarget ?? this._newRenderTarget(false);
    return this._intensityRenderTarget;
  }

  public get blurRenderTarget(): WebGLRenderTarget {
    this._blurRenderTarget =
      this._blurRenderTarget ?? this._newRenderTarget(false);
    return this._blurRenderTarget;
  }

  constructor(
    width: number,
    height: number,
    parameters: GroundReflectionConstructorParameters
  ) {
    this._width = width;
    this._height = height;
    this.parameters = {
      enabled: false,
      intensity: 0.25,
      fadeOutDistance: 1,
      fadeOutExponent: 4,
      brightness: 1.0,
      blurHorizontal: 3.0,
      blurVertical: 6.0,
      blurAscent: 0,
      groundLevel: 0,
      groundReflectionScale: 1,
      renderTargetDownScale: 4,
      ...parameters,
    };
    this._copyMaterial = new CopyTransformMaterial({});
    this._updateCopyMaterial(null);
    this._reflectionIntensityMaterial = new GroundReflectionIntensityMaterial({
      width: this._width / this.parameters.renderTargetDownScale,
      height: this._height / this.parameters.renderTargetDownScale,
    });
    this._blurPass = new BlurPass(BlurShader, parameters);
    this._renderPass = parameters?.renderPass ?? new RenderPass();
  }

  private _newRenderTarget(createDepthTexture: boolean): WebGLRenderTarget {
    const _width = this._width / this.parameters.renderTargetDownScale;
    const _height = this._height / this.parameters.renderTargetDownScale;
    const additionalParameters: any = {};
    if (createDepthTexture) {
      const depthTexture = new DepthTexture(_width, _height);
      depthTexture.format = DepthStencilFormat;
      depthTexture.type = UnsignedInt248Type;
      additionalParameters.minFilter = NearestFilter;
      additionalParameters.magFilter = NearestFilter;
      additionalParameters.depthTexture = depthTexture;
    } else {
      additionalParameters.samples = 1;
    }
    return new WebGLRenderTarget(_width, _height, {
      format: RGBAFormat,
      ...additionalParameters,
    });
  }

  public dispose() {
    this._reflectionRenderTarget?.dispose();
    this._intensityRenderTarget?.dispose();
    this._blurRenderTarget?.dispose();
    this._copyMaterial.dispose();
  }

  public setSize(width: number, height: number) {
    this._width = width;
    this._height = height;
    this._reflectionRenderTarget?.setSize(
      this._width / this.parameters.renderTargetDownScale,
      this._height / this.parameters.renderTargetDownScale
    );
    this._intensityRenderTarget?.setSize(
      this._width / this.parameters.renderTargetDownScale,
      this._height / this.parameters.renderTargetDownScale
    );
    this._blurRenderTarget?.setSize(
      this._width / this.parameters.renderTargetDownScale,
      this._height / this.parameters.renderTargetDownScale
    );
    this._reflectionIntensityMaterial?.update({
      width: this._width / this.parameters.renderTargetDownScale,
      height: this._height / this.parameters.renderTargetDownScale,
    });
  }

  public updateParameters(parameters: GroundReflectionParameters) {
    for (const propertyName in parameters) {
      if (this.parameters.hasOwnProperty(propertyName)) {
        this.parameters[propertyName] = parameters[propertyName];
      }
    }
  }

  public updateBounds(groundLevel: number, groundReflectionScale: number) {
    this.parameters.groundLevel = groundLevel;
    this.parameters.groundReflectionScale = groundReflectionScale;
  }

  private _updateCopyMaterial(
    renderTarget: WebGLRenderTarget | null,
    reflectionFadeInScale: number = 1
  ) {
    const intensity = this.parameters.intensity * reflectionFadeInScale;
    const brightness = this.parameters.brightness;
    this._copyMaterial.update({
      texture: renderTarget?.texture ?? undefined,
      // prettier-ignore
      colorTransform: new Matrix4().set(
        brightness, 0, 0, 0,
        0, brightness, 0, 0,
        0, 0, brightness, 0,
        0, 0, 0, intensity
      ),
      multiplyChannels: 0,
      uvTransform: FLIP_Y_UV_TRANSFORM,
    });
    this._copyMaterial.depthTest = true;
    this._copyMaterial.depthWrite = false;
  }

  public render(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    reflectionFadeInScale: number = 1
  ): void {
    if (!this.parameters.enabled || !(camera instanceof PerspectiveCamera)) {
      return;
    }
    const groundReflectionCamera = this._createGroundReflectionCamera(camera);
    this._renderGroundReflection(
      renderer,
      scene,
      groundReflectionCamera,
      this.reflectionRenderTarget
    );
    this._renderGroundReflectionIntensity(
      renderer,
      groundReflectionCamera,
      this.intensityRenderTarget
    );
    if (
      this.parameters.blurHorizontal > 0 ||
      this.parameters.blurVertical > 0
    ) {
      this.blurReflection(renderer, camera, [
        this.intensityRenderTarget,
        this.blurRenderTarget,
        this.intensityRenderTarget,
      ]);
    }
    this._updateCopyMaterial(this.intensityRenderTarget, reflectionFadeInScale);
    this._renderPass.renderScreenSpace(
      renderer,
      this._copyMaterial,
      renderer.getRenderTarget()
    );
  }

  private _renderGroundReflection(
    renderer: WebGLRenderer,
    scene: Scene,
    groundReflectionCamera: Camera,
    renderTarget: WebGLRenderTarget | undefined
  ) {
    const renderTargetBackup = renderer.getRenderTarget();
    if (renderTarget) {
      renderer.setRenderTarget(renderTarget);
    }
    renderer.render(scene, groundReflectionCamera);
    if (renderTarget) {
      renderer.setRenderTarget(renderTargetBackup);
    }
  }

  private _renderGroundReflectionIntensity(
    renderer: WebGLRenderer,
    groundReflectionCamera: Camera,
    renderTarget: WebGLRenderTarget
  ) {
    const renderTargetBackup = renderer.getRenderTarget();
    renderer.setRenderTarget(renderTarget);
    this._renderPass.renderScreenSpace(
      renderer,
      this._reflectionIntensityMaterial.update({
        texture: this.reflectionRenderTarget.texture,
        depthTexture: this.reflectionRenderTarget.depthTexture,
        camera: groundReflectionCamera,
        groundLevel: this.parameters.groundLevel,
        fadeOutDistance:
          this.parameters.fadeOutDistance *
          this.parameters.groundReflectionScale,
        fadeOutExponent: this.parameters.fadeOutExponent,
      }),
      renderer.getRenderTarget()
    );
    renderer.setRenderTarget(renderTargetBackup);
  }

  public blurReflection(
    renderer: WebGLRenderer,
    camera: Camera,
    renderTargets: WebGLRenderTarget[]
  ): void {
    const cameraUpVector = new Vector3(
      camera.matrixWorld.elements[4],
      camera.matrixWorld.elements[5],
      camera.matrixWorld.elements[6]
    );
    const blurHorMin = this.parameters.blurHorizontal / this._width;
    const blurVerMin =
      (this.parameters.blurVertical / this._height) *
      Math.abs(cameraUpVector.dot(new Vector3(0, 0, 1)));
    this._blurPass.render(
      renderer,
      renderTargets,
      [blurHorMin * 4, blurVerMin * 4],
      [
        blurHorMin * 4 * (1 + this.parameters.blurAscent),
        blurVerMin * 4 * (1 + this.parameters.blurAscent),
      ]
    );
  }

  private _createGroundReflectionCamera(camera: Camera): Camera {
    const groundReflectionCamera = camera.clone() as PerspectiveCamera;
    const cameraOffset = groundReflectionCamera as unknown as CameraOffsets;
    if (cameraOffset._offset) {
      cameraOffset._offset = {
        left: cameraOffset._offset.left,
        top: 1 - cameraOffset._offset.bottom,
        right: cameraOffset._offset.right,
        bottom: 1 - cameraOffset._offset.top,
      };
    }
    groundReflectionCamera.position.set(
      camera.position.x,
      -camera.position.y + 2 * this.parameters.groundLevel,
      camera.position.z
    );
    //groundReflectionCamera.lookAt(0, 2 * groundLevel, 0);
    groundReflectionCamera.rotation.set(
      -camera.rotation.x,
      camera.rotation.y,
      -camera.rotation.z
    );
    //groundReflectionCamera.scale.set(1, -1, 1);
    groundReflectionCamera.updateMatrixWorld();
    groundReflectionCamera.updateProjectionMatrix();
    return groundReflectionCamera;
  }
}

const glslGroundReflectionIntensityVertexShader = `
  varying vec2 vUv;
  void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const glslGroundReflectionIntensityFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 resolution;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform mat4 cameraProjectionMatrix;
  uniform mat4 cameraInverseProjectionMatrix;
  uniform mat4 inverseViewMatrix;
  uniform float groundLevel;
  uniform float fadeOutDistance;
  uniform float fadeOutExponent;
  varying vec2 vUv;

  #include <packing>

  float getDepth(const in vec2 screenPosition) {
    return texture2D(tDepth, screenPosition).x;
  }

  float getLinearDepth(const in vec2 screenPosition) {
    #if PERSPECTIVE_CAMERA == 1
        float fragCoordZ = texture2D(tDepth, screenPosition).x;
        float viewZ = perspectiveDepthToViewZ(fragCoordZ, cameraNear, cameraFar);
        return viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
    #else
        return texture2D(tDepth, screenPosition).x;
    #endif
  }

  float getViewZ(const in float depth) {
    #if PERSPECTIVE_CAMERA == 1
        return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
    #else
        return 0.0;//orthographicDepthToViewZ(depth, cameraNear, cameraFar);
    #endif
  }

  vec3 getViewPosition(const in vec2 screenPosition, const in float depth, const in float viewZ ) {
    float clipW = cameraProjectionMatrix[2][3] * viewZ + cameraProjectionMatrix[3][3];
    vec4 clipPosition = vec4((vec3(screenPosition, depth) - 0.5) * 2.0, 1.0);
    clipPosition *= clipW;
    return (cameraInverseProjectionMatrix * clipPosition).xyz;
  }

  void main() {
    float verticalBias = 1.5 / resolution.y;
    vec2 uv = vUv.xy + vec2(0.0, verticalBias);
    float depth = getDepth(uv);
    float viewZ = getViewZ(depth);
    vec4 worldPosition = inverseViewMatrix * vec4(getViewPosition(uv, depth, viewZ), 1.0);
    float distance = worldPosition.y - groundLevel;
    vec4 fragColor = texture2D(tDiffuse, uv).rgba;
    #if LINEAR_TO_SRGB == 1
      fragColor.rgb = mix(fragColor.rgb * 12.92, 1.055 * pow(fragColor.rgb, vec3(0.41666)) - 0.055, step(0.0031308, fragColor.rgb));
    #endif
    float fadeOutAlpha = pow(clamp(1.0 - distance / fadeOutDistance, 0.0, 1.0), fadeOutExponent);
    fragColor.a *= fadeOutAlpha;
    gl_FragColor = fragColor * step(depth, 0.9999);
  }`;

export interface GroundReflectionIntensityMaterialParameters {
  texture?: Texture;
  depthTexture?: Texture;
  camera?: Camera;
  groundLevel?: number;
  fadeOutDistance?: number;
  fadeOutExponent?: number;
  width?: number;
  height?: number;
}

export class GroundReflectionIntensityMaterial extends ShaderMaterial {
  private static shader = {
    uniforms: {
      tDiffuse: { value: null as Texture | null },
      tDepth: { value: null as Texture | null },
      resolution: { value: new Vector2() },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1 },
      cameraProjectionMatrix: { value: new Matrix4() },
      cameraInverseProjectionMatrix: { value: new Matrix4() },
      inverseViewMatrix: { value: new Matrix4() },
      groundLevel: { value: 0 },
      fadeOutDistance: { value: 1 },
      fadeOutExponent: { value: 1 },
    },
    defines: {
      PERSPECTIVE_CAMERA: 1,
      LINEAR_TO_SRGB: 1,
    },
    vertexShader: glslGroundReflectionIntensityVertexShader,
    fragmentShader: glslGroundReflectionIntensityFragmentShader,
  };

  constructor(parameters?: GroundReflectionIntensityMaterialParameters) {
    super({
      defines: Object.assign(
        {},
        GroundReflectionIntensityMaterial.shader.defines
      ),
      uniforms: UniformsUtils.clone(
        GroundReflectionIntensityMaterial.shader.uniforms
      ),
      vertexShader: GroundReflectionIntensityMaterial.shader.vertexShader,
      fragmentShader: GroundReflectionIntensityMaterial.shader.fragmentShader,
      blending: NoBlending,
    });
    this.update(parameters);
  }

  public update(
    parameters?: GroundReflectionIntensityMaterialParameters
  ): GroundReflectionIntensityMaterial {
    if (parameters?.texture !== undefined) {
      this.uniforms.tDiffuse.value = parameters?.texture;
    }
    if (parameters?.depthTexture !== undefined) {
      this.uniforms.tDepth.value = parameters?.depthTexture;
    }
    if (parameters?.width || parameters?.height) {
      const _width = parameters?.width ?? this.uniforms.resolution.value.x;
      const _height = parameters?.height ?? this.uniforms.resolution.value.y;
      this.uniforms.resolution.value.set(_width, _height);
    }
    if (parameters?.camera !== undefined) {
      const camera =
        (parameters?.camera as OrthographicCamera) ||
        (parameters?.camera as PerspectiveCamera);
      this.uniforms.cameraNear.value = camera.near;
      this.uniforms.cameraFar.value = camera.far;
      this.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
      this.uniforms.cameraInverseProjectionMatrix.value.copy(
        camera.projectionMatrixInverse
      );
      this.uniforms.inverseViewMatrix.value.copy(camera.matrixWorld);
    }
    if (parameters?.groundLevel !== undefined) {
      this.uniforms.groundLevel.value = parameters?.groundLevel;
    }
    if (parameters?.fadeOutDistance !== undefined) {
      this.uniforms.fadeOutDistance.value = parameters?.fadeOutDistance;
    }
    if (parameters?.fadeOutExponent !== undefined) {
      this.uniforms.fadeOutExponent.value = parameters?.fadeOutExponent;
    }
    return this;
  }
}
