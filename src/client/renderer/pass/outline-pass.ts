import { RenderPass } from './render-pass';
import type { RenderPassManager } from '../render-pass-manager';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader';
import type {
  Camera,
  Mesh,
  Object3D,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Matrix4,
  NoBlending,
  ShaderMaterial,
  UniformsUtils,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';

interface ThreeObject3d {
  isLine?: boolean;
  isMesh?: boolean;
  isPoints?: boolean;
  isSprite?: boolean;
}

export interface OutlinePassParameters {
  downSampleRatio?: number;
  edgeDetectionFxaa?: boolean;
}

export class OutlinePass extends RenderPass {
  public static BlurDirectionX = new Vector2(1.0, 0.0);
  public static BlurDirectionY = new Vector2(0.0, 1.0);
  public static highlightLines: boolean = true;
  public renderScene: Scene;
  public renderCamera: Camera;
  public selectedObjects: Object3D[];
  public visibleEdgeColor: Color;
  public hiddenEdgeColor: Color;
  public edgeGlow: number;
  public usePatternTexture: boolean;
  public patternTexture: Texture | null = null;
  public edgeThickness: number;
  public edgeStrength: number;
  public downSampleRatio: number;
  public pulsePeriod: number;
  public edgeDetectionFxaa: boolean;
  public _visibilityCache: Map<Object3D, boolean>;
  public resolution: Vector2;
  public renderTargetMaskBuffer: WebGLRenderTarget;
  public prepareMaskMaterial: ShaderMaterial;
  public renderTargetFxaaBuffer?: WebGLRenderTarget;
  public fxaaRenderMaterial?: ShaderMaterial;
  public renderTargetMaskDownSampleBuffer: WebGLRenderTarget;
  public renderTargetBlurBuffer1: WebGLRenderTarget;
  public renderTargetBlurBuffer2: WebGLRenderTarget;
  public edgeDetectionMaterial: ShaderMaterial;
  public renderTargetEdgeBuffer1: WebGLRenderTarget;
  public renderTargetEdgeBuffer2: WebGLRenderTarget;
  public separableBlurMaterial1: ShaderMaterial;
  public separableBlurMaterial2: ShaderMaterial;
  public overlayMaterial: ShaderMaterial;
  public copyUniforms: any;
  public materialCopy: ShaderMaterial;
  public oldClearColor: Color;
  public oldClearAlpha: number;
  public fsQuad: FullScreenQuad;
  public tempPulseColor1: Color;
  public tempPulseColor2: Color;
  public textureMatrix: Matrix4;
  public clearBackground: boolean = false;

  constructor(
    renderPassManager: RenderPassManager,
    resolution: Vector2,
    scene: Scene,
    camera: Camera,
    selectedObjects: Object3D[],
    parameters?: OutlinePassParameters
  ) {
    super(renderPassManager);

    this.renderScene = scene;
    this.renderCamera = camera;
    this.selectedObjects = selectedObjects !== undefined ? selectedObjects : [];
    this.visibleEdgeColor = new Color(1, 1, 1);
    this.hiddenEdgeColor = new Color(0.1, 0.04, 0.02);
    this.edgeGlow = 0.0;
    this.usePatternTexture = false;
    this.edgeThickness = 1.0;
    this.edgeStrength = 3.0;
    this.downSampleRatio = parameters?.downSampleRatio || 2;
    this.pulsePeriod = 0;
    this.edgeDetectionFxaa = parameters?.edgeDetectionFxaa || false;

    this._visibilityCache = new Map();

    this.resolution =
      resolution !== undefined
        ? new Vector2(resolution.x, resolution.y)
        : new Vector2(256, 256);

    const resx = Math.round(this.resolution.x / this.downSampleRatio);
    const resy = Math.round(this.resolution.y / this.downSampleRatio);

    this.renderTargetMaskBuffer = new WebGLRenderTarget(
      this.resolution.x,
      this.resolution.y
    );
    this.renderTargetMaskBuffer.texture.name = 'OutlinePass.mask';
    this.renderTargetMaskBuffer.texture.generateMipmaps = false;

    this.prepareMaskMaterial = this._getPrepareMaskMaterial(
      this.gBufferTextures?.isFloatGBufferWithRgbNormalAlphaDepth
    );
    this.prepareMaskMaterial.side = DoubleSide;
    this.prepareMaskMaterial.fragmentShader = replaceDepthToViewZ(
      this.prepareMaskMaterial.fragmentShader,
      this.renderCamera
    );

    if (this.edgeDetectionFxaa) {
      this.fxaaRenderMaterial = new ShaderMaterial(FXAAShader);
      this.fxaaRenderMaterial.uniforms.tDiffuse.value =
        this.renderTargetMaskBuffer.texture;
      this.fxaaRenderMaterial.uniforms.resolution.value.set(
        1 / this.resolution.x,
        1 / this.resolution.y
      );
      this.renderTargetFxaaBuffer = new WebGLRenderTarget(
        this.resolution.x,
        this.resolution.y
      );
      this.renderTargetFxaaBuffer.texture.name = 'OutlinePass.fxaa';
      this.renderTargetFxaaBuffer.texture.generateMipmaps = false;
    }

    this.renderTargetMaskDownSampleBuffer = new WebGLRenderTarget(resx, resy);
    this.renderTargetMaskDownSampleBuffer.texture.name =
      'OutlinePass.depthDownSample';
    this.renderTargetMaskDownSampleBuffer.texture.generateMipmaps = false;

    this.renderTargetBlurBuffer1 = new WebGLRenderTarget(resx, resy);
    this.renderTargetBlurBuffer1.texture.name = 'OutlinePass.blur1';
    this.renderTargetBlurBuffer1.texture.generateMipmaps = false;
    this.renderTargetBlurBuffer2 = new WebGLRenderTarget(
      Math.round(resx / 2),
      Math.round(resy / 2)
    );
    this.renderTargetBlurBuffer2.texture.name = 'OutlinePass.blur2';
    this.renderTargetBlurBuffer2.texture.generateMipmaps = false;

    this.edgeDetectionMaterial = this._getEdgeDetectionMaterial();
    this.renderTargetEdgeBuffer1 = new WebGLRenderTarget(resx, resy);
    this.renderTargetEdgeBuffer1.texture.name = 'OutlinePass.edge1';
    this.renderTargetEdgeBuffer1.texture.generateMipmaps = false;
    this.renderTargetEdgeBuffer2 = new WebGLRenderTarget(
      Math.round(resx / 2),
      Math.round(resy / 2)
    );
    this.renderTargetEdgeBuffer2.texture.name = 'OutlinePass.edge2';
    this.renderTargetEdgeBuffer2.texture.generateMipmaps = false;

    const MAX_EDGE_THICKNESS = 4;
    const MAX_EDGE_GLOW = 4;

    this.separableBlurMaterial1 =
      this._getSeperableBlurMaterial(MAX_EDGE_THICKNESS);
    this.separableBlurMaterial1.uniforms.texSize.value.set(resx, resy);
    this.separableBlurMaterial1.uniforms.kernelRadius.value = 1;
    this.separableBlurMaterial2 = this._getSeperableBlurMaterial(MAX_EDGE_GLOW);
    this.separableBlurMaterial2.uniforms.texSize.value.set(
      Math.round(resx / 2),
      Math.round(resy / 2)
    );
    this.separableBlurMaterial2.uniforms.kernelRadius.value = MAX_EDGE_GLOW;

    // Overlay material
    this.overlayMaterial = this._getOverlayMaterial();

    // copy material

    const copyShader = CopyShader;

    this.copyUniforms = UniformsUtils.clone(copyShader.uniforms);
    this.copyUniforms.opacity.value = 1.0;

    this.materialCopy = new ShaderMaterial({
      uniforms: this.copyUniforms,
      vertexShader: copyShader.vertexShader,
      fragmentShader: copyShader.fragmentShader,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });

    this.enabled = true;
    this.needsSwap = false;

    this.oldClearColor = new Color();
    this.oldClearAlpha = 1;

    this.fsQuad = new FullScreenQuad(undefined);

    this.tempPulseColor1 = new Color();
    this.tempPulseColor2 = new Color();
    this.textureMatrix = new Matrix4();

    function replaceDepthToViewZ(string: string, actualCamera: Camera) {
      // @ts-ignore -- wrong typing isPerspectiveCamera is there
      const type = actualCamera.isPerspectiveCamera
        ? 'perspective'
        : 'orthographic';

      return string.replace(/DEPTH_TO_VIEW_Z/g, type + 'DepthToViewZ');
    }
  }

  public dispose() {
    super.dispose();
    this.renderTargetMaskBuffer.dispose();
    this.renderTargetFxaaBuffer?.dispose();
    this.renderTargetMaskDownSampleBuffer.dispose();
    this.renderTargetBlurBuffer1.dispose();
    this.renderTargetBlurBuffer2.dispose();
    this.renderTargetEdgeBuffer1.dispose();
    this.renderTargetEdgeBuffer2.dispose();
    this.prepareMaskMaterial.dispose();
    this.fxaaRenderMaterial?.dispose();
    this.edgeDetectionMaterial.dispose();
    this.separableBlurMaterial1.dispose();
    this.separableBlurMaterial2.dispose();
    this.overlayMaterial.dispose();
    this.materialCopy.dispose();
    this.fsQuad.dispose();
  }

  public setSize(width: number, height: number) {
    this.renderTargetMaskBuffer.setSize(width, height);

    let resx = Math.round(width / this.downSampleRatio);
    let resy = Math.round(height / this.downSampleRatio);
    this.renderTargetMaskDownSampleBuffer.setSize(resx, resy);
    this.renderTargetBlurBuffer1.setSize(resx, resy);
    this.renderTargetEdgeBuffer1.setSize(resx, resy);
    this.separableBlurMaterial1.uniforms.texSize.value.set(resx, resy);

    resx = Math.round(resx / 2);
    resy = Math.round(resy / 2);

    this.renderTargetBlurBuffer2.setSize(resx, resy);
    this.renderTargetEdgeBuffer2.setSize(resx, resy);

    this.separableBlurMaterial2.uniforms.texSize.value.set(resx, resy);

    this.fxaaRenderMaterial?.uniforms.resolution.value.set(
      1 / this.resolution.x,
      1 / this.resolution.y
    );
    this.renderTargetFxaaBuffer?.setSize(width, height);
  }

  private _canBeHighlighted(object: Object3D) {
    return (
      (object as ThreeObject3d).isMesh ||
      (OutlinePass.highlightLines && (object as ThreeObject3d).isLine)
    );
  }

  private _changeVisibilityOfSelectedObjects(bVisible: boolean) {
    const cache = this._visibilityCache;
    this.selectedObjects.forEach((selectedObject) =>
      selectedObject.traverse((object: Object3D) => {
        if (this._canBeHighlighted(object)) {
          if (bVisible === true) {
            object.visible = cache.get(object) as boolean;
          } else {
            cache.set(object, object.visible);
            object.visible = bVisible;
          }
        }
      })
    );
  }

  private _changeVisibilityOfNonSelectedObjects(bVisible: boolean) {
    const cache = this._visibilityCache;
    const selectedMeshes: Mesh[] = [];
    this.selectedObjects.forEach((selectedObject) =>
      selectedObject.traverse((object: Object3D) => {
        if (this._canBeHighlighted(object)) {
          selectedMeshes.push(object as Mesh);
        }
      })
    );

    this.renderScene.traverse((object: Object3D) => {
      if (
        this._canBeHighlighted(object) ||
        (object as ThreeObject3d).isSprite
      ) {
        const bFound = selectedMeshes.some(
          (selectedMesh) => selectedMesh.id === object.id
        );
        if (bFound === false) {
          const visibility = object.visible;
          if (bVisible === false || cache.get(object) === true) {
            object.visible = bVisible;
          }
          cache.set(object, visibility);
        }
      } else if ((object as ThreeObject3d).isPoints) {
        if (bVisible === true) {
          object.visible = cache.get(object) as boolean; // restore
        } else {
          cache.set(object, object.visible);
          object.visible = bVisible;
        }
      }
    });
  }

  private _updateTextureMatrix() {
    // prettier-ignore
    this.textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0
    );
    this.textureMatrix.multiply(this.renderCamera.projectionMatrix);
    this.textureMatrix.multiply(this.renderCamera.matrixWorldInverse);
  }

  public render(
    renderer: WebGLRenderer,
    _writeBuffer: WebGLRenderTarget | null,
    readBuffer: WebGLRenderTarget | null,
    _deltaTime: number,
    maskActive: boolean
  ) {
    if (this.selectedObjects.length > 0) {
      renderer.getClearColor(this.oldClearColor);
      this.oldClearAlpha = renderer.getClearAlpha();
      const oldAutoClear = renderer.autoClear;

      if (this.clearBackground) {
        renderer.setClearColor(0x000000, 0xff);
        renderer.clear(true, false, false);
      }
      renderer.autoClear = false;

      if (maskActive) {
        renderer.state.buffers.stencil.setTest(false);
      }

      renderer.setClearColor(0xffffff, 1);

      // Make selected objects invisible
      this._changeVisibilityOfSelectedObjects(false);

      const currentBackground = this.renderScene.background;
      this.renderScene.background = null;

      // Make selected objects visible
      this._changeVisibilityOfSelectedObjects(true);
      this._visibilityCache.clear();

      // Update Texture Matrix for Depth compare
      this._updateTextureMatrix();

      // Make non selected objects invisible, and draw only the selected objects, by comparing the depth buffer of non selected objects
      this._changeVisibilityOfNonSelectedObjects(false);
      this.renderScene.overrideMaterial = this.prepareMaskMaterial;
      this.prepareMaskMaterial.uniforms.cameraNearFar.value.set(
        // @ts-ignore -- wrong typing near is there
        this.renderCamera.near,
        // @ts-ignore -- wrong typing far is there
        this.renderCamera.far
      );
      this.prepareMaskMaterial.uniforms.depthTexture.value =
        this.gBufferTextures.textureWithDepthValue;
      this.prepareMaskMaterial.uniforms.textureMatrix.value =
        this.textureMatrix;
      renderer.setRenderTarget(this.renderTargetMaskBuffer);
      renderer.clear();
      renderer.render(this.renderScene, this.renderCamera);
      this.renderScene.overrideMaterial = null;
      this._changeVisibilityOfNonSelectedObjects(true);
      this._visibilityCache.clear();

      this.renderScene.background = currentBackground;

      // FXAA
      let renderTargetMaskBuffer = this.renderTargetMaskBuffer;
      if (
        this.edgeDetectionFxaa &&
        this.fxaaRenderMaterial &&
        this.renderTargetFxaaBuffer
      ) {
        this.fxaaRenderMaterial.uniforms.tDiffuse.value =
          this.renderTargetMaskBuffer.texture;
        this.fsQuad.material = this.fxaaRenderMaterial;
        renderer.setRenderTarget(this.renderTargetFxaaBuffer);
        renderer.clear();
        this.fsQuad.render(renderer);
        renderTargetMaskBuffer = this.renderTargetFxaaBuffer;
      }

      // 2. Downsample to Half resolution
      this.fsQuad.material = this.materialCopy;
      this.copyUniforms.tDiffuse.value = renderTargetMaskBuffer.texture;
      renderer.setRenderTarget(this.renderTargetMaskDownSampleBuffer);
      renderer.clear();
      this.fsQuad.render(renderer);

      this.tempPulseColor1.copy(this.visibleEdgeColor);
      this.tempPulseColor2.copy(this.hiddenEdgeColor);

      if (this.pulsePeriod > 0) {
        const scalar =
          (1 + 0.25) / 2 +
          (Math.cos((performance.now() * 0.01) / this.pulsePeriod) *
            (1.0 - 0.25)) /
            2;
        this.tempPulseColor1.multiplyScalar(scalar);
        this.tempPulseColor2.multiplyScalar(scalar);
      }

      // 3. Apply Edge Detection Pass
      this.fsQuad.material = this.edgeDetectionMaterial;
      this.edgeDetectionMaterial.uniforms.maskTexture.value =
        this.renderTargetMaskDownSampleBuffer.texture;
      this.edgeDetectionMaterial.uniforms.texSize.value.set(
        this.renderTargetMaskDownSampleBuffer.width,
        this.renderTargetMaskDownSampleBuffer.height
      );
      this.edgeDetectionMaterial.uniforms.visibleEdgeColor.value =
        this.tempPulseColor1;
      this.edgeDetectionMaterial.uniforms.hiddenEdgeColor.value =
        this.tempPulseColor2;
      renderer.setRenderTarget(this.renderTargetEdgeBuffer1);
      renderer.clear();
      this.fsQuad.render(renderer);

      // 4. Apply Blur on Half res
      this.fsQuad.material = this.separableBlurMaterial1;
      this.separableBlurMaterial1.uniforms.colorTexture.value =
        this.renderTargetEdgeBuffer1.texture;
      this.separableBlurMaterial1.uniforms.direction.value =
        OutlinePass.BlurDirectionX;
      this.separableBlurMaterial1.uniforms.kernelRadius.value =
        this.edgeThickness;
      renderer.setRenderTarget(this.renderTargetBlurBuffer1);
      renderer.clear();
      this.fsQuad.render(renderer);
      this.separableBlurMaterial1.uniforms.colorTexture.value =
        this.renderTargetBlurBuffer1.texture;
      this.separableBlurMaterial1.uniforms.direction.value =
        OutlinePass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetEdgeBuffer1);
      renderer.clear();
      this.fsQuad.render(renderer);

      // Apply Blur on quarter res
      this.fsQuad.material = this.separableBlurMaterial2;
      this.separableBlurMaterial2.uniforms.colorTexture.value =
        this.renderTargetEdgeBuffer1.texture;
      this.separableBlurMaterial2.uniforms.direction.value =
        OutlinePass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetBlurBuffer2);
      renderer.clear();
      this.fsQuad.render(renderer);
      this.separableBlurMaterial2.uniforms.colorTexture.value =
        this.renderTargetBlurBuffer2.texture;
      this.separableBlurMaterial2.uniforms.direction.value =
        OutlinePass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetEdgeBuffer2);
      renderer.clear();
      this.fsQuad.render(renderer);

      // Blend it additively over the input texture
      this.fsQuad.material = this.overlayMaterial;
      this.overlayMaterial.uniforms.maskTexture.value =
        renderTargetMaskBuffer.texture;
      this.overlayMaterial.uniforms.edgeTexture1.value =
        this.renderTargetEdgeBuffer1.texture;
      this.overlayMaterial.uniforms.edgeTexture2.value =
        this.renderTargetEdgeBuffer2.texture;
      this.overlayMaterial.uniforms.patternTexture.value = this.patternTexture;
      this.overlayMaterial.uniforms.edgeStrength.value = this.edgeStrength;
      this.overlayMaterial.uniforms.edgeGlow.value = this.edgeGlow;
      this.overlayMaterial.uniforms.usePatternTexture.value =
        this.usePatternTexture;

      if (maskActive) {
        renderer.state.buffers.stencil.setTest(true);
      }

      renderer.setRenderTarget(readBuffer);
      this.fsQuad.render(renderer);

      renderer.setClearColor(this.oldClearColor, this.oldClearAlpha);
      renderer.autoClear = oldAutoClear;
    }

    if (this.renderToScreen && readBuffer) {
      this.fsQuad.material = this.materialCopy;
      this.copyUniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    }
  }

  public renderPass(renderer: WebGLRenderer): void {
    this.render(renderer, null, null, 0, false);
  }

  private _getPrepareMaskMaterial(floatAlphaDepth?: boolean) {
    return new ShaderMaterial({
      uniforms: {
        depthTexture: { value: null },
        cameraNearFar: { value: new Vector2(0.5, 0.5) },
        textureMatrix: { value: null },
      },

      defines: {
        FLOAT_ALPHA_DEPTH: floatAlphaDepth ? 1 : 0,
      },

      vertexShader: `#include <morphtarget_pars_vertex>
				#include <skinning_pars_vertex>

				varying vec4 projTexCoord;
				varying vec4 vPosition;
				uniform mat4 textureMatrix;

				void main() {

					#include <skinbase_vertex>
					#include <begin_vertex>
					#include <morphtarget_vertex>
					#include <skinning_vertex>
					#include <project_vertex>

					vPosition = mvPosition;

					vec4 worldPosition = vec4( transformed, 1.0 );

					#ifdef USE_INSTANCING

						worldPosition = instanceMatrix * worldPosition;

					#endif
					
					worldPosition = modelMatrix * worldPosition;

					projTexCoord = textureMatrix * worldPosition;

				}`,

      fragmentShader: `#include <packing>
				varying vec4 vPosition;
				varying vec4 projTexCoord;
				uniform sampler2D depthTexture;
				uniform vec2 cameraNearFar;

				void main() {

          #if FLOAT_ALPHA_DEPTH == 1
					  float depth = texture2DProj( depthTexture, projTexCoord ).w;
          #else
            float depth = unpackRGBAToDepth(texture2DProj( depthTexture, projTexCoord ));
          #endif
					float viewZ = - DEPTH_TO_VIEW_Z( depth, cameraNearFar.x, cameraNearFar.y );
					float depthTest = (-vPosition.z > viewZ) ? 1.0 : 0.0;
					gl_FragColor = vec4(0.0, depthTest, 1.0, 1.0);

				}`,
    });
  }

  private _getEdgeDetectionMaterial() {
    return new ShaderMaterial({
      uniforms: {
        maskTexture: { value: null },
        texSize: { value: new Vector2(0.5, 0.5) },
        visibleEdgeColor: { value: new Vector3(1.0, 1.0, 1.0) },
        hiddenEdgeColor: { value: new Vector3(1.0, 1.0, 1.0) },
      },

      vertexShader: `varying vec2 vUv;

				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,

      fragmentShader: `varying vec2 vUv;

				uniform sampler2D maskTexture;
				uniform vec2 texSize;
				uniform vec3 visibleEdgeColor;
				uniform vec3 hiddenEdgeColor;

				void main() {
					vec2 invSize = 1.0 / texSize;
					vec4 uvOffset = vec4(1.0, 0.0, 0.0, 1.0) * vec4(invSize, invSize);
					vec4 c1 = texture2D( maskTexture, vUv + uvOffset.xy);
					vec4 c2 = texture2D( maskTexture, vUv - uvOffset.xy);
					vec4 c3 = texture2D( maskTexture, vUv + uvOffset.yw);
					vec4 c4 = texture2D( maskTexture, vUv - uvOffset.yw);
					float diff1 = (c1.r - c2.r)*0.5;
					float diff2 = (c3.r - c4.r)*0.5;
					float d = length( vec2(diff1, diff2) );
					float a1 = min(c1.g, c2.g);
					float a2 = min(c3.g, c4.g);
					float visibilityFactor = min(a1, a2);
					vec3 edgeColor = 1.0 - visibilityFactor > 0.001 ? visibleEdgeColor : hiddenEdgeColor;
					gl_FragColor = vec4(edgeColor, 1.0) * vec4(d);
				}`,
    });
  }

  private _getSeperableBlurMaterial(maxRadius: number) {
    return new ShaderMaterial({
      defines: {
        MAX_RADIUS: maxRadius,
      },

      uniforms: {
        colorTexture: { value: null },
        texSize: { value: new Vector2(0.5, 0.5) },
        direction: { value: new Vector2(0.5, 0.5) },
        kernelRadius: { value: 1.0 },
      },

      vertexShader: `varying vec2 vUv;

				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,

      fragmentShader: `#include <common>
				varying vec2 vUv;
				uniform sampler2D colorTexture;
				uniform vec2 texSize;
				uniform vec2 direction;
				uniform float kernelRadius;

				float gaussianPdf(in float x, in float sigma) {
					return 0.39894 * exp( -0.5 * x * x/( sigma * sigma))/sigma;
				}

				void main() {
					vec2 invSize = 1.0 / texSize;
					float sigma = kernelRadius/2.0;
					float weightSum = gaussianPdf(0.0, sigma);
					vec4 diffuseSum = texture2D( colorTexture, vUv) * weightSum;
					vec2 delta = direction * invSize * kernelRadius/float(MAX_RADIUS);
					vec2 uvOffset = delta;
					for( int i = 1; i <= MAX_RADIUS; i ++ ) {
						float x = kernelRadius * float(i) / float(MAX_RADIUS);
						float w = gaussianPdf(x, sigma);
						vec4 sample1 = texture2D( colorTexture, vUv + uvOffset);
						vec4 sample2 = texture2D( colorTexture, vUv - uvOffset);
						diffuseSum += ((sample1 + sample2) * w);
						weightSum += (2.0 * w);
						uvOffset += delta;
					}
					gl_FragColor = diffuseSum/weightSum;
				}`,
    });
  }

  private _getOverlayMaterial() {
    return new ShaderMaterial({
      uniforms: {
        maskTexture: { value: null },
        edgeTexture1: { value: null },
        edgeTexture2: { value: null },
        patternTexture: { value: null },
        edgeStrength: { value: 1.0 },
        edgeGlow: { value: 1.0 },
        usePatternTexture: { value: 0.0 },
      },

      vertexShader: `varying vec2 vUv;

				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,

      fragmentShader: `varying vec2 vUv;

				uniform sampler2D maskTexture;
				uniform sampler2D edgeTexture1;
				uniform sampler2D edgeTexture2;
				uniform sampler2D patternTexture;
				uniform float edgeStrength;
				uniform float edgeGlow;
				uniform bool usePatternTexture;

				void main() {
					vec4 edgeValue1 = texture2D(edgeTexture1, vUv);
					vec4 edgeValue2 = texture2D(edgeTexture2, vUv);
					vec4 maskColor = texture2D(maskTexture, vUv);
					vec4 patternColor = texture2D(patternTexture, 6.0 * vUv);
					float visibilityFactor = 1.0 - maskColor.g > 0.0 ? 1.0 : 0.5;
					vec4 edgeValue = edgeValue1 + edgeValue2 * edgeGlow;
					vec4 finalColor = edgeStrength * maskColor.r * edgeValue;
					if(usePatternTexture)
						finalColor += + visibilityFactor * (1.0 - maskColor.r) * (1.0 - patternColor.r);
					gl_FragColor = finalColor;
                }`,
      blending: AdditiveBlending,
      //blending: CustomBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
  }
}
