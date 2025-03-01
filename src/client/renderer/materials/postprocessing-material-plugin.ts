import {
  MeshPhysicalMaterial,
  type MeshStandardMaterial,
  type ShaderLibShader,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { Nullable } from '../../utils/types';

export class PostProcessingMaterialPlugin {
  public applyAoAndShadowToAlpha: boolean = false;
  private _aoPassMapUniform: { value: Nullable<Texture> } = { value: null };
  private _aoPassMapScaleUniform: { value: number } = { value: 1 };
  private _aoPassMapIntensityUniform: { value: number } = { value: 1 };
  private _shPassMapIntensityUniform: { value: number } = { value: 1 };
  private _reflectionPassMapUniform: { value: Nullable<Texture> } = {
    value: null,
  };
  private _reflectionPassMapScaleUniform: { value: number } = { value: 1 };
  private _reflectionPassMapIntensityUniform: { value: number } = { value: 0 };
  public applyReflectionPassMap: boolean = false;

  set aoPassMap(value: Nullable<Texture>) {
    this._aoPassMapUniform.value = value;
  }

  set aoPassMapScale(value: number) {
    this._aoPassMapScaleUniform.value = value;
  }

  set aoPassMapIntensity(value: number) {
    this._aoPassMapIntensityUniform.value = value;
  }

  set shPassMapIntensity(value: number) {
    this._shPassMapIntensityUniform.value = value;
  }

  set reflectionPassMap(value: Nullable<Texture>) {
    this._reflectionPassMapUniform.value = value;
  }

  set reflectionPassMapScale(value: number) {
    this._reflectionPassMapScaleUniform.value = value;
  }

  set reflectionPassMapIntensity(value: number) {
    this._reflectionPassMapIntensityUniform.value = value;
  }

  public static addPlugin(
    material: MeshStandardMaterial
  ): PostProcessingMaterialPlugin | null {
    if (material instanceof MeshPhysicalMaterial && material.transmission > 0) {
      return null;
    }
    if (material.userData.postProcessingMaterialPlugin !== undefined) {
      return material.userData.postProcessingMaterialPlugin instanceof
        PostProcessingMaterialPlugin
        ? material.userData.postProcessingMaterialPlugin
        : null;
    }
    const plugin = new PostProcessingMaterialPlugin();
    material.userData.postProcessingMaterialPlugin = plugin;
    material.onBeforeCompile = (
      materialShader: ShaderLibShader,
      renderer: WebGLRenderer
    ) => plugin._onBeforeCompile(materialShader, renderer);
    material.customProgramCacheKey = () => plugin._customProgramCacheKey();
    return plugin;
  }

  private _isEnabled() {
    return (
      this._aoPassMapUniform.value !== undefined &&
      this._aoPassMapUniform.value !== null
    );
  }

  private _customProgramCacheKey() {
    let passMapKey: string = '';
    if (this._isEnabled()) {
      passMapKey += 'aoPassMap' + (this.applyAoAndShadowToAlpha ? 'Alpha' : '');
    }
    if (this.applyReflectionPassMap) {
      passMapKey += 'reflectionPassMap';
    }
    return passMapKey;
  }

  private _onBeforeCompile(
    materialShader: ShaderLibShader,
    _renderer: WebGLRenderer
  ) {
    const activatePlugIn = this._isEnabled() || this.applyReflectionPassMap;
    if (activatePlugIn) {
      let parsReplacement: string = this.applyAoAndShadowToAlpha
        ? '#define USE_APPLY_AO_AND_SHADOW_TO_ALPHA\n'
        : '';
      parsReplacement += this.applyReflectionPassMap
        ? '#define USE_REFLECTION_PASS_MAP\n'
        : '';
      parsReplacement += aoMapParsFragmentReplacement;
      materialShader.fragmentShader = materialShader.fragmentShader.replace(
        '#include <aomap_pars_fragment>',
        parsReplacement
      );
      materialShader.fragmentShader = materialShader.fragmentShader.replace(
        '#include <aomap_fragment>',
        aoMapFragmentReplacement
      );
      this._initUniforms(materialShader);
    }
  }

  private _initUniforms(materialShader: ShaderLibShader) {
    if (materialShader) {
      materialShader.uniforms.tAoPassMap = this._aoPassMapUniform;
      materialShader.uniforms.aoPassMapScale = this._aoPassMapScaleUniform;
      materialShader.uniforms.aoPassMapIntensity =
        this._aoPassMapIntensityUniform;
      materialShader.uniforms.shPassMapIntensity =
        this._shPassMapIntensityUniform;
      materialShader.uniforms.tReflectionPassMap =
        this._reflectionPassMapUniform;
      materialShader.uniforms.reflectionPassMapScale =
        this._reflectionPassMapScaleUniform;
      materialShader.uniforms.reflectionPassMapIntensity =
        this._reflectionPassMapIntensityUniform;
    }
  }
}

const aoMapParsFragmentReplacement = /* glsl */ `
#ifdef USE_AOMAP

	uniform sampler2D aoMap;
	uniform float aoMapIntensity;

#endif

	uniform highp sampler2D tAoPassMap;
  uniform float aoPassMapScale;
  uniform float aoPassMapIntensity;
  uniform float shPassMapIntensity;
  uniform sampler2D tReflectionPassMap;
  uniform float reflectionPassMapScale;
  uniform float reflectionPassMapIntensity;
`;

const aoMapFragmentReplacement = /* glsl */ `
#ifndef AOPASSMAP_SWIZZLE
	#define AOPASSMAP_SWIZZLE rg
#endif

float ambientOcclusion = 1.0;
float shadowValue = 1.0;
	
#ifdef USE_AOMAP

	// reads channel R, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
	ambientOcclusion = texture2D( aoMap, vAoMapUv ).r;
  ambientOcclusion = ( ambientOcclusion - 1.0 ) * aoMapIntensity + 1.0;

#endif

  vec4 aoAndShadowMap = texelFetch( tAoPassMap, ivec2( gl_FragCoord.xy * aoPassMapScale ), 0 );
  vec2 aoAndShadow = aoAndShadowMap.rg;
  float depthDelta = abs( dot(aoAndShadowMap.wz, vec2(1.0/1024.0)) - gl_FragCoord.z );
  const ivec2 aoOffsetArray[8] = ivec2[8](
    ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1), ivec2(1, 1), ivec2(-1, 1), ivec2(1, -1), ivec2(-1, -1));
  for (int aoOffsetI = 0; aoOffsetI < 8; aoOffsetI++) {
    aoAndShadowMap = texelFetch( tAoPassMap, ivec2( gl_FragCoord.xy * aoPassMapScale ) + aoOffsetArray[aoOffsetI], 0 );
    float testDepthDelta = abs( dot(aoAndShadowMap.wz, vec2(1.0/1024.0)) - gl_FragCoord.z );
    if (testDepthDelta < depthDelta) {
      aoAndShadow = aoAndShadowMap.rg;
      depthDelta = testDepthDelta;
    }
  }
  
  float aoPassMapValue = aoPassMapIntensity < 0.0 ? 1.0 : max(0.0, (aoAndShadow.r - 1.0) * aoPassMapIntensity + 1.0);
  shadowValue = shPassMapIntensity < 0.0 ? 1.0 : max(0.0, (aoAndShadow.g - 1.0) * shPassMapIntensity + 1.0);

  #ifdef USE_REFLECTION_PASS_MAP

    ivec2 reflectionPassMapSize = textureSize( tReflectionPassMap, 0 );
    vec2 reflectionPassMapUv = vec2( gl_FragCoord.x * reflectionPassMapScale, float(reflectionPassMapSize.y) - gl_FragCoord.y * reflectionPassMapScale );
    vec4 reflectionPassMapColor = texture2D( tReflectionPassMap, reflectionPassMapUv / vec2(reflectionPassMapSize) );
    if (reflectionPassMapColor.a > 0.0) reflectionPassMapColor.rgb /= reflectionPassMapColor.a;
    vec3 diffuseReflectionPassMapColor = reflectionPassMapColor.rgb * material.diffuseColor;
    reflectedLight.indirectDiffuse += diffuseReflectionPassMapColor * reflectionPassMapColor.a * reflectionPassMapIntensity;
    //reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, diffuseReflectionPassMapColor, reflectionPassMapColor.a * reflectionPassMapIntensity);

  #endif

  #if defined ( USE_APPLY_AO_AND_SHADOW_TO_ALPHA )
    diffuseColor.a = 1.0 - (1.0 - diffuseColor.a) * aoPassMapValue * shadowValue;
  #else
    ambientOcclusion = min( ambientOcclusion, aoPassMapValue );
  #endif

	reflectedLight.indirectDiffuse *= ambientOcclusion * shadowValue;
  
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion * shadowValue;
	#endif

	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion * shadowValue;
	#endif

	#if defined( USE_ENVMAP ) && defined( STANDARD )

		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    
        float specularOcclusion = computeSpecularOcclusion( dotNV, ambientOcclusion * shadowValue, material.roughness );
		reflectedLight.indirectSpecular *= specularOcclusion;

    #ifdef USE_REFLECTION_PASS_MAP
        reflectedLight.indirectSpecular += material.specularColor * reflectionPassMapColor.rgb * reflectionPassMapColor.a * reflectionPassMapIntensity * specularOcclusion;
    #endif  
    
	#endif
`;
