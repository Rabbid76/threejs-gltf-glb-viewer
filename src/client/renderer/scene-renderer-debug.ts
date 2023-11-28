import { RenderPass } from './render-utility';
import type { CopyTransformMaterialParameters } from './shader-utility';
import {
  ALPHA_RGBA,
  ALPHA_TRANSFORM,
  CopyTransformMaterial,
  DEFAULT_TRANSFORM,
  DEFAULT_UV_TRANSFORM,
  FLIP_Y_UV_TRANSFORM,
  GRAYSCALE_TRANSFORM,
  interpolationMatrix,
  LinearDepthRenderMaterial,
  RED_TRANSFORM,
  RGB_TRANSFORM,
  ZERO_RGBA,
} from './shader-utility';
import type { SceneRenderer } from './scene-renderer';
import type { GBufferRenderTargets } from './gbuffer-render-target';
import type { BakedGroundContactShadow } from './baked-ground-contact-shadow';
import type { ScreenSpaceShadowMap } from './screen-space-shadow-map';
import { ShadowAndAoPass } from './shadow-and-ao-pass';
import type { GroundReflectionPass } from './ground-reflection-pass';
import { EnvironmentMapDecodeMaterial } from './light-source-detection';
import type {
  Camera,
  Material,
  Scene,
  ShaderMaterial,
  Texture,
  WebGLRenderer,
} from 'three';
import {
  Color,
  DoubleSide,
  Matrix4,
  MeshStandardMaterial,
  NoBlending,
  OrthographicCamera,
  Vector4,
} from 'three';

type RenderFunction = (
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera
) => void;

export class DebugPass {
  public grayMaterial = new MeshStandardMaterial({
    color: 0xc0c0c0,
    side: DoubleSide,
    envMapIntensity: 0.4,
  });
  private _environmentMapDecodeMaterial: EnvironmentMapDecodeMaterial;
  private _sceneRenderer: SceneRenderer;
  private _copyMaterial?: CopyTransformMaterial;
  private _depthRenderMaterial?: LinearDepthRenderMaterial;
  private _renderPass: RenderPass = new RenderPass();

  constructor(sceneRenderer: SceneRenderer) {
    this._sceneRenderer = sceneRenderer;
    this._environmentMapDecodeMaterial = new EnvironmentMapDecodeMaterial(
      true,
      false
    );
    this._environmentMapDecodeMaterial.blending = NoBlending;
    this._environmentMapDecodeMaterial.depthTest = false;
  }

  private get _gBufferRenderTarget(): GBufferRenderTargets {
    return this._sceneRenderer.gBufferRenderTarget;
  }

  private get _screenSpaceShadow(): ScreenSpaceShadowMap {
    return this._sceneRenderer.screenSpaceShadow;
  }

  private get _shadowAndAoPass(): ShadowAndAoPass {
    return this._sceneRenderer.shadowAndAoPass;
  }

  private get _groundReflectionPass(): GroundReflectionPass {
    return this._sceneRenderer.groundReflectionPass;
  }

  private get _bakedGroundContactShadow(): BakedGroundContactShadow {
    return this._sceneRenderer.bakedGroundContactShadow;
  }

  public dispose(): void {
    this._depthRenderMaterial?.dispose();
    this._copyMaterial?.dispose();
    this.grayMaterial.dispose();
  }

  protected getCopyMaterial(
    parameters?: CopyTransformMaterialParameters
  ): ShaderMaterial {
    this._copyMaterial = this._copyMaterial ?? new CopyTransformMaterial();
    return this._copyMaterial.update(parameters);
  }

  private _getDepthRenderMaterial(camera: Camera): LinearDepthRenderMaterial {
    this._depthRenderMaterial =
      this._depthRenderMaterial ??
      new LinearDepthRenderMaterial({
        depthTexture: this._gBufferRenderTarget.textureWithDepthValue,
        depthFilter: this._gBufferRenderTarget
          .isFloatGBufferWithRgbNormalAlphaDepth
          ? new Vector4(0, 0, 0, 1)
          : new Vector4(1, 0, 0, 0),
      });
    return this._depthRenderMaterial.update({ camera });
  }

  public render(
    preRenderPasses: RenderFunction,
    _renderPass: RenderFunction,
    postProcessingPassed: RenderFunction,
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    debugOutput: string
  ): void {
    preRenderPasses(renderer, scene, camera);
    if (debugOutput === 'color') {
      renderer.render(scene, camera);
      return;
    }
    if (debugOutput === 'grayscale') {
      this._sceneRenderer.renderCacheManager.render('debug', scene, () => {
        this._renderPass.renderWithOverrideMaterial(
          renderer,
          scene,
          camera,
          this.grayMaterial as Material,
          null,
          0,
          1
        );
      });
    } else {
      _renderPass(renderer, scene, camera);
    }
    postProcessingPassed(renderer, scene, camera);
    this._renderDebugPass(renderer, scene, camera, debugOutput);
  }

  // eslint-disable-next-line complexity
  private _renderDebugPass(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    debugOutput: string
  ): void {
    switch (debugOutput) {
      default:
        break;
      case 'lineardepth':
        this._renderPass.renderScreenSpace(
          renderer,
          this._getDepthRenderMaterial(camera),
          null
        );
        break;
      case 'g-normal':
        if (this._gBufferRenderTarget.isFloatGBufferWithRgbNormalAlphaDepth) {
          this._renderPass.renderScreenSpace(
            renderer,
            this.getCopyMaterial({
              texture: this._gBufferRenderTarget?.gBufferTexture,
              blending: NoBlending,
              // prettier-ignore
              colorTransform: new Matrix4().set(
                  0.5, 0, 0, 0,
                  0, 0.5, 0, 0,
                  0, 0, 0.5, 0,
                  0, 0, 0, 0,
              ),
              colorBase: new Vector4(0.5, 0.5, 0.5, 1),
              multiplyChannels: 0,
              uvTransform: DEFAULT_UV_TRANSFORM,
            }),
            null
          );
        } else {
          this._renderPass.renderScreenSpace(
            renderer,
            this.getCopyMaterial({
              texture: this._gBufferRenderTarget?.gBufferTexture,
              blending: NoBlending,
              colorTransform: RGB_TRANSFORM,
              colorBase: ALPHA_RGBA,
              multiplyChannels: 0,
              uvTransform: DEFAULT_UV_TRANSFORM,
            }),
            null
          );
        }
        break;
      case 'g-depth':
        if (this._gBufferRenderTarget.isFloatGBufferWithRgbNormalAlphaDepth) {
          this._renderPass.renderScreenSpace(
            renderer,
            this.getCopyMaterial({
              texture: this._gBufferRenderTarget?.gBufferTexture,
              blending: NoBlending,
              colorTransform: ALPHA_TRANSFORM,
              colorBase: ALPHA_RGBA,
              multiplyChannels: 0,
              uvTransform: DEFAULT_UV_TRANSFORM,
            }),
            null
          );
        } else {
          this._renderPass.renderScreenSpace(
            renderer,
            this.getCopyMaterial({
              texture: this._gBufferRenderTarget?.depthBufferTexture,
              blending: NoBlending,
              colorTransform: RED_TRANSFORM,
              colorBase: ALPHA_RGBA,
              multiplyChannels: 0,
              uvTransform: DEFAULT_UV_TRANSFORM,
            }),
            null
          );
        }
        break;
      case 'ssao':
        this._renderPass.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture:
              this._shadowAndAoPass.shadowAndAoRenderTargets.passRenderTarget
                .texture,
            blending: NoBlending,
            colorTransform: GRAYSCALE_TRANSFORM,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'ssaodenoise':
        this._renderPass.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture: this._shadowAndAoPass.denoiseRenderTargetTexture,
            blending: NoBlending,
            colorTransform: GRAYSCALE_TRANSFORM,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'shadowmap':
        this._renderPass.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture: this._screenSpaceShadow.shadowTexture,
            blending: NoBlending,
            colorTransform: GRAYSCALE_TRANSFORM,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'shadow':
        this._renderPass.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture:
              this._shadowAndAoPass.shadowAndAoRenderTargets.passRenderTarget
                .texture,
            blending: NoBlending,
            colorTransform: ShadowAndAoPass.shadowTransform,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'shadowblur':
        this._renderPass.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture: this._shadowAndAoPass.denoiseRenderTargetTexture,
            blending: NoBlending,
            colorTransform: ShadowAndAoPass.shadowTransform,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'shadowfadein':
        this._renderPass.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture: this._shadowAndAoPass.fadeRenderTarget.texture,
            blending: NoBlending,
            colorTransform: ShadowAndAoPass.shadowTransform,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'shadowandao':
        this._renderPass.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture: this._shadowAndAoPass.denoiseRenderTargetTexture,
            blending: NoBlending,
            colorTransform: interpolationMatrix(
              this._shadowAndAoPass.parameters.aoIntensity,
              this._shadowAndAoPass.parameters.shadowIntensity,
              0,
              1
            ),
            colorBase: ZERO_RGBA,
            multiplyChannels: 1,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'groundreflection':
        this._renderPass.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture: this._groundReflectionPass.reflectionRenderTarget.texture,
            blending: NoBlending,
            colorTransform: DEFAULT_TRANSFORM,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: FLIP_Y_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'bakedgroundshadow':
        this._renderPass.renderScreenSpace(
          renderer,
          this.getCopyMaterial({
            texture: this._bakedGroundContactShadow.renderTarget.texture,
            blending: NoBlending,
            colorTransform: DEFAULT_TRANSFORM,
            colorBase: ZERO_RGBA,
            multiplyChannels: 0,
            uvTransform: DEFAULT_UV_TRANSFORM,
          }),
          null
        );
        break;
      case 'environmentmap':
        this._environmentMapDecodeMaterial.setSourceTexture(
          scene.environment as Texture
        );
        this._renderPass.renderScreenSpace(
          renderer,
          this._environmentMapDecodeMaterial,
          null
        );
        break;
      case 'lightsourcedetection':
        if (scene.userData?.environmentDefinition) {
          const aspect = this._sceneRenderer.width / this._sceneRenderer.height;
          const environmentCamera = new OrthographicCamera(
            -1,
            1,
            1 / aspect,
            -1 / aspect,
            -1,
            1
          );
          const environmentScene =
            scene.userData?.environmentDefinition.createDebugScene(
              renderer,
              scene
            );
          environmentScene.background = new Color(0xffffff);
          renderer.render(environmentScene, environmentCamera);
        }
        break;
    }
  }
}
