import type { Box3, Shader, WebGLRenderer } from 'three';
import { MeshLambertMaterial, Vector2, Vector3, Vector4 } from 'three';

interface ThreeShader {
  defines?: { [key: string]: any };
  uniforms?: { [key: string]: any };
}

export class IlluminationBufferMaterial extends MeshLambertMaterial {
  private static _shadowFadeOut: Vector2 = new Vector2(0.1, 20);
  private static _sceneBoxMin: Vector3 = new Vector3(-1, -1, -1);
  private static _sceneBoxMax: Vector3 = new Vector3(1, 1, 1);
  private static _distributionProperties: Vector4 = new Vector4(1, 1, 1, 0);

  constructor(parameters?: any) {
    super(parameters);
    this.onBeforeCompile = this._onBeforeCompile;
  }

  public static setShadowParameters(
    directionalDependency: number,
    directionalExponent: number,
    groundContainment: number,
    distance: number,
    blur: number
  ) {
    IlluminationBufferMaterial._distributionProperties.set(
      directionalDependency,
      directionalExponent,
      groundContainment,
      0
    );
    IlluminationBufferMaterial._shadowFadeOut.set(distance, blur);
  }

  public static setBoundingBox(box: Box3) {
    IlluminationBufferMaterial._sceneBoxMin.copy(box.min);
    IlluminationBufferMaterial._sceneBoxMax.copy(box.max);
  }

  private _onBeforeCompile(materialShader: Shader, _renderer: WebGLRenderer) {
    materialShader.vertexShader = screenSpaceShadowMaterialVertexShader;
    materialShader.fragmentShader = screenSpaceShadowMaterialFragmentShader;
    (materialShader as ThreeShader).defines = Object.assign({
      ...(materialShader as ThreeShader).defines,
      DYNAMIC_SHADOW_RADIUS: '',
    });
    const uniforms = (materialShader as ThreeShader).uniforms;
    if (uniforms) {
      uniforms.distributionProperties = {
        value: IlluminationBufferMaterial._distributionProperties,
      };
      uniforms.shadowFadeOut = {
        value: IlluminationBufferMaterial._shadowFadeOut,
      };
      uniforms.sceneBoxMin = { value: IlluminationBufferMaterial._sceneBoxMin };
      uniforms.sceneBoxMax = { value: IlluminationBufferMaterial._sceneBoxMax };
    }
  }
}

const screenSpaceShadowMaterialVertexShader = `
#define LAMBERT

varying vec3 vViewPosition;
varying vec3 vWorldPosition;

#include <common>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {
  #include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>

	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>

	vViewPosition = - mvPosition.xyz;

	#include <worldpos_vertex>
	#include <shadowmap_vertex>

  vWorldPosition = worldPosition.xyz;
}
`;

const screenSpaceShadowMaterialFragmentShader = `
#define LAMBERT

uniform vec3 diffuse;
uniform float opacity;

varying vec3 vViewPosition;
varying vec3 vWorldPosition;

#ifdef DYNAMIC_SHADOW_RADIUS
  uniform vec2 shadowFadeOut;
  uniform vec3 sceneBoxMin;
  uniform vec3 sceneBoxMax;
#endif
uniform vec4 distributionProperties;

#include <common>
#include <packing>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

vec2 getShadowDynamicScale() {

  vec2 dynamicScale = vec2(0.0, 1.0);

#ifdef DYNAMIC_SHADOW_RADIUS
  if (shadowFadeOut.x > 0.0) {
    vec3 boxDistanceVec = max(vec3(0.0), max(sceneBoxMin - vWorldPosition, vWorldPosition - sceneBoxMax));
    float boxDistance = length(boxDistanceVec);
    
    // linear interpolation gives better result than smooth Hermite interpolation
    // float shadowBase = smoothstep(0.0, shadowFadeOut.x, boxDistance);
    float shadowBase = boxDistance / shadowFadeOut.x;

    shadowBase = clamp(shadowBase, 0.0, 1.0);
    dynamicScale = vec2(shadowBase, 1.0 - shadowBase);
  }
#endif

  return dynamicScale;
}

float getShadowDynamicRadius(sampler2D shadowMap, float shadowBias, float shadowRadius, vec4 shadowCoord, vec2 shadowScale) {

  float dynamicRadius = shadowRadius;

#ifdef DYNAMIC_SHADOW_RADIUS
  shadowCoord.xyz /= shadowCoord.w;
  shadowCoord.z += shadowBias;

  bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
  bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
  if (frustumTest && shadowFadeOut.x > 0.0) {
    float shadowDepth = unpackRGBAToDepth(texture2D(shadowMap, shadowCoord.xy));
    float delta = shadowDepth - shadowCoord.z;
    float fadeOutScale = max(shadowScale.x, smoothstep(max(shadowDepth, 0.5), shadowFadeOut.x * 0.5 + 0.5, shadowCoord.z));
    dynamicRadius = shadowRadius + shadowFadeOut.y * max(0.0, fadeOutScale);
  }
#endif

  return dynamicRadius;
}

void main() {

	#include <clipping_planes_fragment>

	vec4 diffuseColor = vec4( diffuse, opacity );
	
	#include <logdepthbuf_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>

	// accumulation

	vec3 geometryPosition = - vViewPosition;
  vec3 geometryNormal = normal;
  vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );

  IncidentLight directLight;

  vec3 accumulatedShadowLight = vec3(0.0);
  vec3 directionDependentShadowLight = vec3(1.0);
  float groundDistance = clamp((vWorldPosition.y - sceneBoxMin.y) * 100.0, 0.0, 1.0);
  float groundContainment = mix(1.0, groundDistance, distributionProperties.z);
  vec2 dynamicScale = getShadowDynamicScale();
  #if ( NUM_DIR_LIGHTS > 0 )

    DirectionalLight directionalLight;
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      DirectionalLightShadow directionalLightShadow;
    #endif

    float dynamicRadius;
    vec3 incidentLightSum = vec3(0.0);
    vec3 incidentShadowLight = vec3(0.0);
    float shadowFactor;
    float dotNL;
    float incidentLightFactor;

  #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

      directionalLight = directionalLights[ i ];
      getDirectionalLightInfo( directionalLight, directLight );
      dotNL = dot(dot(geometryNormal, geometryPosition) >= 0.0 ? -geometryNormal : geometryNormal, directLight.direction);
      incidentLightFactor = clamp(dotNL, 0.0, 1.0);

      dynamicRadius = 0.0;
      shadowFactor = 1.0;
      #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
        directionalLightShadow = directionalLightShadows[ i ];
        dynamicRadius = getShadowDynamicRadius(directionalShadowMap[i], directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[i], dynamicScale);
        shadowFactor = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, dynamicRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
      #endif

      accumulatedShadowLight += directLight.color * shadowFactor * saturate(min(dotNL * 10.0 + 0.9, 1.0));
      incidentLightFactor = mix(
        mix(pow(incidentLightFactor, 4.0), 1.0, step(0.99, shadowFactor)),
        pow(incidentLightFactor, distributionProperties.y),
        groundContainment);
      incidentLightSum += directLight.color * mix(incidentLightFactor, 1.0, groundContainment);
      incidentShadowLight += directLight.color * mix(
        shadowFactor * incidentLightFactor, 
        mix(1.0, shadowFactor, incidentLightFactor), 
        groundContainment);
    }
  #pragma unroll_loop_end

    if (dot(incidentLightSum, vec3(1.0)) > 0.01) {
      directionDependentShadowLight = incidentShadowLight / incidentLightSum;
    }
  #else
    accumulatedShadowLight = vec3(1.0);
  #endif  

	// modulation

	vec3 outgoingLight = mix(accumulatedShadowLight, directionDependentShadowLight, max(distributionProperties.x, 1.0 - groundDistance));
  outgoingLight = dynamicScale.x + directionDependentShadowLight.y * outgoingLight;

	#include <opaque_fragment>
	#include <premultiplied_alpha_fragment>
}
`;
