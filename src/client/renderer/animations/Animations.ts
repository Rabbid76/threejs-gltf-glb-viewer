import type { Nullable } from '../../utils/types';
import { AnimationMixer } from 'three';
import type { AnimationClip, Object3D } from 'three';
import { Clock } from 'three';

export interface AnimatedObject {
  clip: AnimationClip;
  model: Object3D;
}

export class AnimationPlayer {
  private _animationMixer: Nullable<AnimationMixer> = null;
  private _animations: AnimatedObject[] = [];
  private _clock: Clock = new Clock();

  public dispose(): void {
    this.clear();
  }

  public animate(): boolean {
    if (this._animationMixer) {
      const delta = this._clock.getDelta();
      this._animationMixer.update(delta);
      return true;
    }
    return false;
  }

  public addAnimation(animation: AnimatedObject): void {
    if (!this._animationMixer) {
      this._animationMixer = new AnimationMixer(animation.model);
      if (this._animationMixer) {
        this._animations.push(animation);
        this._animationMixer.clipAction(animation.clip).play();
        this._clock = new Clock();
      }
    }
  }

  public clear(): void {
    if (this._animationMixer) {
      this._animationMixer.stopAllAction();
      for (const animation of this._animations) {
        this._animationMixer.uncacheAction(animation.clip, animation.model);
      }
      this._animations = [];
      this._animationMixer = null;
    }
  }
}
