import type {
  Blending,
  Camera,
  MeshNormalMaterial,
  OrthographicCamera,
  PerspectiveCamera,
} from 'three';
import { UniformsUtils, NoBlending, ShaderMaterial } from 'three';

export interface GBufferNormalDepthMaterialParameters {
  floatBufferType?: boolean;
  linearDepth?: boolean;
  camera?: Camera;
  blending?: Blending;
}

export type GBufferNormalDepthMaterial =
  | NormalAndDepthRenderMaterial
  | MeshNormalMaterial;

const glslNormalAndDepthVertexShader = `varying vec3 vNormal;
#if LINEAR_DEPTH == 1
    varying float vZ;  
#endif

  void main() {
      vNormal = normalMatrix * normal;
      vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
      #if LINEAR_DEPTH == 1
          vZ = viewPosition.z;  
      #endif
      gl_Position = projectionMatrix * viewPosition;
  }`;

const glslNormalAndDepthFragmentShader = `varying vec3 vNormal;
#if LINEAR_DEPTH == 1
  varying float vZ;  
  uniform float cameraNear;
  uniform float cameraFar;
#endif

  void main() {
      #if FLOAT_BUFFER == 1
          vec3 normal = normalize(vNormal);
      #else
          vec3 normal = normalize(vNormal) * 0.5 + 0.5;
      #endif
      #if LINEAR_DEPTH == 1
          float depth = (-vZ - cameraNear) / (cameraFar - cameraNear);
      #else
          float depth = gl_FragCoord.z;
      #endif
      gl_FragColor = vec4(normal, depth);
  }`;

export class NormalAndDepthRenderMaterial extends ShaderMaterial {
  private static _normalAndDepthShader = {
    uniforms: {
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1 },
    },
    defines: {
      FLOAT_BUFFER: 0,
      LINEAR_DEPTH: 0,
    },
    vertexShader: glslNormalAndDepthVertexShader,
    fragmentShader: glslNormalAndDepthFragmentShader,
  };

  constructor(parameters: GBufferNormalDepthMaterialParameters) {
    super({
      defines: Object.assign({
        ...NormalAndDepthRenderMaterial._normalAndDepthShader.defines,
        FLOAT_BUFFER: parameters?.floatBufferType ? 1 : 0,
        LINEAR_DEPTH: parameters?.linearDepth ? 1 : 0,
      }),
      uniforms: UniformsUtils.clone(
        NormalAndDepthRenderMaterial._normalAndDepthShader.uniforms
      ),
      vertexShader:
        NormalAndDepthRenderMaterial._normalAndDepthShader.vertexShader,
      fragmentShader:
        NormalAndDepthRenderMaterial._normalAndDepthShader.fragmentShader,
      blending: parameters?.blending ?? NoBlending,
    });
    this.update(parameters);
  }

  public update(
    parameters?: GBufferNormalDepthMaterialParameters
  ): NormalAndDepthRenderMaterial {
    if (parameters?.camera !== undefined) {
      const camera =
        (parameters?.camera as OrthographicCamera) ||
        (parameters?.camera as PerspectiveCamera);
      this.uniforms.cameraNear.value = camera.near;
      this.uniforms.cameraFar.value = camera.far;
    }
    return this;
  }
}
