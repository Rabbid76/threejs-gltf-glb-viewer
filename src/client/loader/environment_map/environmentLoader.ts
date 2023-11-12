import { createUniformColorTexture } from '../../renderer/render-utility'
import { EnvironmentDefinition } from '../../renderer/environment-definition'
import { EnvMapReader } from './environemtMapReader';
import {
    Color,
    CubeTexture,
    Scene,
    Texture,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader'
import { GUI, GUIController } from 'dat.gui';

export class EnvironmentLoader {
    public defaultBackgroundColor: Color = new Color(0xffffff);
    public defaultEnvironmentColor: Color = new Color(0xc0c0c0);
    public defaultEnvironmentTexture: Texture;
    private envMapReader?: EnvMapReader;
    private exrLoader?: EXRLoader;
    private rgbeLoader?: RGBELoader;
    private environemtMap: Map<string, EnvironmentDefinition> = new Map();
    private uiFolder?: GUI = undefined;
    private environmentController?: GUIController = undefined;
    private environmentName: string = '';
    public currentEnvironment?: EnvironmentDefinition = undefined;
    private showBackground: boolean = false;

    constructor() {
        this.defaultEnvironmentTexture = createUniformColorTexture(this.defaultEnvironmentColor);
    }

    public setEnvironment(scene: Scene, parameters?: any): boolean {
        const environment = this.environemtMap.get(this.environmentName.length > 0 ? this.environmentName : 'room environment');
        const changed = this.currentEnvironment !== environment;
        this.showBackground = parameters?.showEnvironment ?? false;
        this.currentEnvironment = environment;
        if (this.currentEnvironment && parameters?.environmentRotation) {
            this.currentEnvironment.rotation = parameters.environmentRotation;
        }
        if (this.currentEnvironment && parameters?.environmentIntensity) {
            this.currentEnvironment.intensity = parameters.environmentIntensity;
        }
        scene.userData.showEnvironmentBackground = this.showBackground;
        scene.userData.environmentDefinition = this.currentEnvironment;
        return changed;
    }

    public loadDefaultEnvironment(changeEnvironment: boolean, createScene?: () => Scene) {
        const defaultEnvironmentName = 'room environment';
        const roomScene = (createScene && createScene()) ?? new RoomEnvironment();
        this.environemtMap.set(defaultEnvironmentName, new EnvironmentDefinition(roomScene));
        if (changeEnvironment) {
            this.environmentName = defaultEnvironmentName;
        }
        this.updateUI();
    }

    public loadEnvmap(resourceName: string, resource: string, changeEnvironment: boolean) {
        this.loadAndSetCubeTexture((cubeTexture: CubeTexture) => {
            this.environemtMap.set(resourceName, new EnvironmentDefinition(cubeTexture));
            if (changeEnvironment) {
                this.environmentName = resourceName;
            }
            this.updateUI();
        }, resource);
    }

    public loadExr(resourceName: string, resource: string, changeEnvironment: boolean) {
        this.loadExrAndSetTexture((texture: Texture, textureData: any) => {
            this.environemtMap.set(resourceName, new EnvironmentDefinition(texture, { textureData } ));
            if (changeEnvironment) {
                this.environmentName = resourceName;
            }
            this.updateUI();
        }, resource)
    }

    public loadHdr(resourceName: string, resource: string, changeEnvironment: boolean) {
        this.loadHdrAndSetTexture((texture: Texture, textureData: any) => {
            this.environemtMap.set(resourceName, new EnvironmentDefinition(texture, { textureData }));
            if (changeEnvironment) {
                this.environmentName = resourceName;
            }
            this.updateUI();
        }, resource)
    }

    private loadAndSetCubeTexture(setCubeTexture: (cubeTexture: CubeTexture) => void, resource: string): void {
        if (!resource) {
            return;
        }
        if (!this.envMapReader) {
            this.envMapReader = new EnvMapReader();
        }
        this.envMapReader.load(resource).then((texture: any) => {
            const cubeTexture = texture as CubeTexture;
            if (cubeTexture) {
                setCubeTexture(cubeTexture)
            }
        });
    }
    
    private async loadExrAndSetTexture(setTexture: (texture: Texture, textureData: any) => void, resource: string) {
        if (!resource) {
            return;
        }
        if (!this.exrLoader) {
            this.exrLoader = new EXRLoader();
        }
        this.exrLoader.load(resource, (texture: Texture, textureData: any) => {
            setTexture(texture, textureData);
        });
    }
    
    private loadHdrAndSetTexture(setTexture: (texture: Texture, textureData: any) => void, resource: string): void {
        if (!resource) {
            return;
        }
        if (!this.rgbeLoader) {
            this.rgbeLoader = new RGBELoader();
        }
        this.rgbeLoader.load(resource, (texture: Texture, textureData: any) => {
            setTexture(texture, textureData);
        });
    }

    public addGUI(uiFolder: GUI): void {
        this.uiFolder = uiFolder;
        this.updateUI();
    }

    private updateUI(): void {
        if (this.uiFolder) {
            const environmentNames = Array.from(this.environemtMap.keys());
            if (this.environmentController) {
                let innerHTMLStr = "";
                environmentNames.forEach((environmentName) => {
                    innerHTMLStr += "<option value='" + environmentName + "'>" + environmentName + "</option>";
                });
                this.environmentController.domElement.children[0].innerHTML = innerHTMLStr;
                this.environmentController.setValue(this.environmentName);
                this.environmentController.updateDisplay();
            } else {
                this.environmentController = this.uiFolder.add<any>(this, 'environmentName', environmentNames);
            }
        }
    }
}