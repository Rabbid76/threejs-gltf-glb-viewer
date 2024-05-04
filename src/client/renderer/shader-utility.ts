import type { Enumify } from '../utils/types';
import type {
  Blending,
  BlendingDstFactor,
  BlendingEquation,
  BlendingSrcFactor,
  OrthographicCamera,
  PerspectiveCamera,
  Texture,
} from 'three';
import {
  AddEquation,
  DstAlphaFactor,
  DstColorFactor,
  Matrix3,
  Matrix4,
  NoBlending,
  ShaderMaterial,
  UniformsUtils,
  Vector2,
  Vector4,
  ZeroFactor,
} from 'three';

const CopyTransformShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    colorTransform: { value: new Matrix4() },
    colorBase: { value: new Vector4(0, 0, 0, 0) },
    multiplyChannels: { value: 0 },
    uvTransform: { value: new Matrix3() },
  },
  vertexShader: `
        varying vec2 vUv;
        uniform mat3 uvTransform;
  
        void main() {
            vUv = (uvTransform * vec3(uv, 1.0)).xy;
            gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
        }`,
  fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform mat4 colorTransform;
        uniform vec4 colorBase;
        uniform float multiplyChannels;
        varying vec2 vUv;
  
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            #if PREMULTIPLIED_ALPHA == 1
              if (color.a > 0.0) color.rgb /= color.a;
            #endif
            color = colorTransform * color + colorBase;
            color.rgb = mix(color.rgb, vec3(color.r * color.g * color.b), multiplyChannels);
            #if LINEAR_TO_SRGB == 1
              color.rgb = mix(color.rgb * 12.92, 1.055 * pow(color.rgb, vec3(0.41666)) - 0.055, step(0.0031308, color.rgb));
            #endif
            gl_FragColor = color;
        }`,
};

export const DEFAULT_TRANSFORM: Matrix4 = new Matrix4();
// prettier-ignore
export const RGB_TRANSFORM: Matrix4 = new Matrix4().set(
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 0
);
// prettier-ignore
export const ALPHA_TRANSFORM: Matrix4 = new Matrix4().set(
  0, 0, 0, 1,
  0, 0, 0, 1,
  0, 0, 0, 1,
  0, 0, 0, 0
);
// prettier-ignore
export const RED_TRANSFORM: Matrix4 = new Matrix4().set(
  1, 0, 0, 0,
  1, 0, 0, 0,
  1, 0, 0, 0,
  0, 0, 0, 1
);
// prettier-ignore
export const BLUE_TRANSFORM: Matrix4 = new Matrix4().set(
  0, 1, 0, 0,
  0, 1, 0, 0,
  0, 1, 0, 0,
  0, 0, 0, 1
);
// prettier-ignore
export const GREEN_TRANSFORM: Matrix4 = new Matrix4().set(
  0, 0, 1, 0,
  0, 0, 1, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
);
// prettier-ignore
export const GRAYSCALE_TRANSFORM: Matrix4 = new Matrix4().set(
  1, 0, 0, 0,
  1, 0, 0, 0,
  1, 0, 0, 0,
  0, 0, 0, 1
);
export const ZERO_RGBA: Vector4 = new Vector4(0, 0, 0, 0);
export const ALPHA_RGBA: Vector4 = new Vector4(0, 0, 0, 1);
export const DEFAULT_UV_TRANSFORM: Matrix3 = new Matrix3();
// prettier-ignore
export const FLIP_Y_UV_TRANSFORM: Matrix3 = new Matrix3().set(
  1, 0, 0,
  0, -1, 1,
  0, 0, 1
);

// prettier-ignore
export const interpolationMatrix = (r: number, g: number, b: number, a: number): Matrix4 => {
  // prettier-ignore
  return new Matrix4().set(
    r, 0, 0, 1 - r,
    0, g, 0, 1 - g,
    0, 0, b, 1 - b,
    0, 0, 0, a
  );
};

export const COLOR_COPY_BLEND_MODES = {
  DEFAULT: 'default',
  ADDITIVE: 'additive',
} as const;

export type CopyMaterialBlendMode = Enumify<typeof COLOR_COPY_BLEND_MODES>;

export interface CopyTransformMaterialParameters {
  texture?: Texture | null;
  colorTransform?: Matrix4;
  colorBase?: Vector4;
  multiplyChannels?: number;
  uvTransform?: Matrix3;
  blending?: Blending;
  blendSrc?: BlendingSrcFactor | BlendingDstFactor;
  blendDst?: BlendingDstFactor;
  blendEquation?: BlendingEquation;
  blendSrcAlpha?: number;
  blendDstAlpha?: number;
  blendEquationAlpha?: number;
}

export class CopyTransformMaterial extends ShaderMaterial {
  constructor(
    parameters?: CopyTransformMaterialParameters,
    copyBlendMode: CopyMaterialBlendMode = COLOR_COPY_BLEND_MODES.ADDITIVE,
    linearToSrgb: boolean = false,
    premultipliedALpha: boolean = false
  ) {
    const blendingParameters =
      copyBlendMode === COLOR_COPY_BLEND_MODES.ADDITIVE
        ? {
            blendSrc: DstColorFactor,
            blendDst: ZeroFactor,
            blendEquation: AddEquation,
            blendSrcAlpha: DstAlphaFactor,
            blendDstAlpha: ZeroFactor,
            blendEquationAlpha: AddEquation,
          }
        : {};
    super({
      uniforms: UniformsUtils.clone(CopyTransformShader.uniforms),
      vertexShader: CopyTransformShader.vertexShader,
      fragmentShader: CopyTransformShader.fragmentShader,
      defines: {
        LINEAR_TO_SRGB: linearToSrgb ? 1 : 0,
        PREMULTIPLIED_ALPHA: premultipliedALpha ? 1 : 0,
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      ...blendingParameters,
    });
    this.update(parameters);
  }

  public update(
    parameters?: CopyTransformMaterialParameters
  ): CopyTransformMaterial {
    if (parameters?.texture !== undefined) {
      this.uniforms.tDiffuse.value = parameters?.texture;
    }
    if (parameters?.colorTransform !== undefined) {
      this.uniforms.colorTransform.value = parameters?.colorTransform;
    }
    if (parameters?.colorBase !== undefined) {
      this.uniforms.colorBase.value = parameters?.colorBase;
    }
    if (parameters?.multiplyChannels !== undefined) {
      this.uniforms.multiplyChannels.value = parameters?.multiplyChannels;
    }
    if (parameters?.uvTransform !== undefined) {
      this.uniforms.uvTransform.value = parameters?.uvTransform;
    }
    if (parameters?.blending !== undefined) {
      this.blending = parameters?.blending;
    }
    if (parameters?.blendSrc !== undefined) {
      this.blendSrc = parameters?.blendSrc;
    }
    if (parameters?.blendDst !== undefined) {
      this.blendDst = parameters?.blendDst;
    }
    if (parameters?.blendEquation !== undefined) {
      this.blendEquation = parameters?.blendEquation;
    }
    if (parameters?.blendSrcAlpha !== undefined) {
      this.blendSrcAlpha = parameters?.blendSrcAlpha;
    }
    if (parameters?.blendDstAlpha !== undefined) {
      this.blendDstAlpha = parameters?.blendDstAlpha;
    }
    if (parameters?.blendEquationAlpha !== undefined) {
      this.blendEquationAlpha = parameters?.blendEquationAlpha;
    }
    return this;
  }
}

export const BlurShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    rangeMin: { value: new Vector2(1.0 / 512.0, 1.0 / 512.0) },
    rangeMax: { value: new Vector2(1.0 / 512.0, 1.0 / 512.0) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 rangeMin;
    uniform vec2 rangeMax;
    varying vec2 vUv;
  
    void main() {
        vec4 baseColor = texture2D(tDiffuse, vUv);
        vec2 blur = mix(rangeMax, rangeMin, baseColor.a);
        vec4 sum = vec4( 0.0 );
        sum += texture2D(tDiffuse, vUv - 1.0 * blur) * 0.051;
        sum += texture2D(tDiffuse, vUv - 0.75 * blur) * 0.0918;
        sum += texture2D(tDiffuse, vUv - 0.5 * blur) * 0.12245;
        sum += texture2D(tDiffuse, vUv - 0.25 * blur) * 0.1531;
        sum += baseColor * 0.1633;
        sum += texture2D(tDiffuse, vUv + 0.25 * blur) * 0.1531;
        sum += texture2D(tDiffuse, vUv + 0.5 * blur) * 0.12245;
        sum += texture2D(tDiffuse, vUv + 0.75 * blur) * 0.0918;
        sum += texture2D(tDiffuse, vUv + 1.0 * blur) * 0.051;
        gl_FragColor = sum;
    }`,
};

export const MixShadowShader = {
  uniforms: {
    tShadow1: { value: null as Texture | null },
    tShadow2: { value: null as Texture | null },
    shadowScale1: { value: 0.5 },
    shadowScale2: { value: 0.5 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tShadow1;
    uniform sampler2D tShadow2;
    uniform float shadowScale1;
    uniform float shadowScale2;
    varying vec2 vUv;
  
    void main() {
        vec4 color1 = texture2D(tShadow1, vUv);
        vec4 color2 = texture2D(tShadow2, vUv);
        gl_FragColor = color1 * shadowScale1 + color2 * shadowScale2;
    }`,
};

export const HorizontalBlurShadowShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    blur: { value: 1.0 / 512.0 },
    shadowRange: { value: new Vector2(0.1, 0.9) },
  },
  defines: {
    DEBUG_BLUR_AREA: 0,
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float blur;
    uniform vec2 shadowRange;
    varying vec2 vUv;
  
    void main() {
        vec4 baseColor = texture2D(tDiffuse, vUv);
        float h = blur * step(shadowRange.x, baseColor.r) * step(baseColor.r, shadowRange.y);
        vec4 sum = vec4(0.0);
        sum += texture2D( tDiffuse, vec2( vUv.x - 4.0 * h, vUv.y ) ) * 0.051;
        sum += texture2D( tDiffuse, vec2( vUv.x - 3.0 * h, vUv.y ) ) * 0.0918;
        sum += texture2D( tDiffuse, vec2( vUv.x - 2.0 * h, vUv.y ) ) * 0.12245;
        sum += texture2D( tDiffuse, vec2( vUv.x - 1.0 * h, vUv.y ) ) * 0.1531;
        sum += baseColor * 0.1633;
        sum += texture2D( tDiffuse, vec2( vUv.x + 1.0 * h, vUv.y ) ) * 0.1531;
        sum += texture2D( tDiffuse, vec2( vUv.x + 2.0 * h, vUv.y ) ) * 0.12245;
        sum += texture2D( tDiffuse, vec2( vUv.x + 3.0 * h, vUv.y ) ) * 0.0918;
        sum += texture2D( tDiffuse, vec2( vUv.x + 4.0 * h, vUv.y ) ) * 0.051;
  #if DEBUG_BLUR_AREA == 1        
        gl_FragColor = h > 0.001 ? vec4(sum.r, 0.0, 0.0, 1.0) : sum;
  #else
        gl_FragColor = min(sum, baseColor);
  #endif
    }`,
};

export const VerticalBlurShadowShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    blur: { value: 1.0 / 512.0 },
    shadowRange: { value: new Vector2(0.1, 0.9) },
  },
  defines: {
    DEBUG_BLUR_AREA: 0,
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float blur;
    uniform vec2 shadowRange;
    varying vec2 vUv;
  
    void main() {
        vec4 baseColor = texture2D(tDiffuse, vUv);
        float v = blur * step(shadowRange.x, baseColor.r) * step(baseColor.r, shadowRange.y);
        vec4 sum = vec4(0.0);
        sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 4.0 * v ) ) * 0.051;
        sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 3.0 * v ) ) * 0.0918;
        sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 2.0 * v ) ) * 0.12245;
        sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 1.0 * v ) ) * 0.1531;
        sum += baseColor * 0.1633;
        sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 1.0 * v ) ) * 0.1531;
        sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 2.0 * v ) ) * 0.12245;
        sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 3.0 * v ) ) * 0.0918;
        sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 4.0 * v ) ) * 0.051;
  #if DEBUG_BLUR_AREA == 1        
        gl_FragColor = v > 0.001 ? vec4(sum.r, 0.0, 0.0, 1.0) : sum;
  #else
        gl_FragColor = min(sum, baseColor);
  #endif
    }`,
};

const glslLinearDepthVertexShader = `varying vec2 vUv;
  void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }`;

const glslLinearDepthFragmentShader = `uniform sampler2D tDepth;
  uniform vec4 depthFilter;
  uniform float cameraNear;
  uniform float cameraFar;
  varying vec2 vUv;
  
  #include <packing>
  
  float getLinearDepth(const in vec2 screenPosition) {
      float fragCoordZ = dot(texture2D(tDepth, screenPosition), depthFilter);
      #if PERSPECTIVE_CAMERA == 1
          float viewZ = perspectiveDepthToViewZ(fragCoordZ, cameraNear, cameraFar);
          return viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
      #else
          return fragCoordZ;
      #endif
  }
  
  void main() {
      float depth = getLinearDepth(vUv);
      gl_FragColor = vec4(vec3(1.0 - depth), 1.0);
  }`;

export class LinearDepthRenderMaterial extends ShaderMaterial {
  private static _linearDepthShader: any = {
    uniforms: {
      tDepth: { value: null as Texture | null },
      depthFilter: { value: new Vector4(1, 0, 0, 0) },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1 },
    },
    defines: {
      PERSPECTIVE_CAMERA: 1,
      ALPHA_DEPTH: 0,
    },
    vertexShader: glslLinearDepthVertexShader,
    fragmentShader: glslLinearDepthFragmentShader,
  };

  constructor(parameters: Record<string, any>) {
    super({
      defines: Object.assign(
        {},
        LinearDepthRenderMaterial._linearDepthShader.defines
      ),
      uniforms: UniformsUtils.clone(
        LinearDepthRenderMaterial._linearDepthShader.uniforms
      ),
      vertexShader: LinearDepthRenderMaterial._linearDepthShader.vertexShader,
      fragmentShader:
        LinearDepthRenderMaterial._linearDepthShader.fragmentShader,
      blending: NoBlending,
    });
    this.update(parameters);
  }

  public update(parameters?: Record<string, any>): LinearDepthRenderMaterial {
    if (parameters?.depthTexture !== undefined) {
      this.uniforms.tDepth.value = parameters?.depthTexture;
    }
    if (parameters?.camera !== undefined) {
      const camera =
        (parameters?.camera as OrthographicCamera) ||
        (parameters?.camera as PerspectiveCamera);
      this.uniforms.cameraNear.value = camera.near;
      this.uniforms.cameraFar.value = camera.far;
    }
    if (parameters?.depthFilter !== undefined) {
      this.uniforms.depthFilter.value = parameters?.depthFilter;
    }
    return this;
  }
}
