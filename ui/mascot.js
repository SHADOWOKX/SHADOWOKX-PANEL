import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

export const MASCOT_ACTIVE_FRAME_MS = 150;
export const MASCOT_POST_CLOSE_AWAKE_MS = 3000;
export const MASCOT_WAKE_MS = 330;
export const MASCOT_SLEEP_TRANSITION_MS = 330;
export const MASCOT_SLEEP_MIN_MS = 8000;
export const MASCOT_SLEEP_MAX_MS = 15000;

export const MascotState = Object.freeze({
    SLEEPING: 'sleeping',
    WAKING: 'waking',
    AWAKE: 'awake',
    ACTIVE: 'active',
    GOING_TO_SLEEP: 'going-to-sleep',
});

const FRAME_NAMES = Object.freeze([
    'robot-sleep.svg',
    'robot-sleep-breathe.svg',
    'robot-sleep-twitch.svg',
    'robot-awake.svg',
    'robot-wake-antenna.svg',
    'robot-wake-half.svg',
    'robot-sleepy.svg',
    'robot-sleep-relax.svg',
    'robot-blink.svg',
    ...Array.from({length: 13}, (_unused, index) =>
        `robot-active-${String(index + 1).padStart(2, '0')}.svg`),
]);

const ACTIVE_SEQUENCES = Object.freeze([
    Object.freeze([
        ['robot-active-01.svg', 140],
        ['robot-active-05.svg', 150],
        ['robot-active-12.svg', 150],
        ['robot-active-03.svg', 120],
        ['robot-active-01.svg', 230],
    ]),
    Object.freeze([
        ['robot-active-01.svg', 130],
        ['robot-active-11.svg', 250],
        ['robot-active-10.svg', 230],
        ['robot-active-07.svg', 140],
        ['robot-active-01.svg', 220],
    ]),
    Object.freeze([
        ['robot-active-01.svg', 140],
        ['robot-active-08.svg', 270],
        ['robot-active-09.svg', 270],
        ['robot-active-04.svg', 120],
        ['robot-active-03.svg', 120],
        ['robot-active-01.svg', 220],
    ]),
    Object.freeze([
        ['robot-active-02.svg', 130],
        ['robot-active-13.svg', 280],
        ['robot-active-06.svg', 140],
        ['robot-active-01.svg', 220],
    ]),
]);

const WAKE_SEQUENCE = Object.freeze([
    ['robot-sleep.svg', 70],
    ['robot-wake-antenna.svg', 90],
    ['robot-wake-half.svg', 100],
    ['robot-awake.svg', 70],
]);

const SLEEP_SEQUENCE = Object.freeze([
    ['robot-awake.svg', 70],
    ['robot-sleepy.svg', 90],
    ['robot-sleep-relax.svg', 100],
    ['robot-sleep.svg', 70],
]);

function mascotPath(extension, name) {
    return GLib.build_filenamev([extension.path, 'icons', 'mascot', name]);
}

function mascotIcon(extension, name, size, styleClass) {
    return new St.Icon({
        gicon: Gio.icon_new_for_string(mascotPath(extension, name)),
        icon_size: size,
        width: size,
        height: size,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: styleClass,
    });
}

export function staticMascotIcon(extension, size = 20, styleClass = '') {
    return mascotIcon(extension, 'robot-awake.svg', size, styleClass);
}

export function sleepingMascotIcon(extension, size = 20, styleClass = '') {
    return mascotIcon(extension, 'robot-sleep.svg', size, styleClass);
}

export class MascotController {
    constructor(extension, settings, size = 20) {
        this._extension = extension;
        this._settings = settings;
        this._destroyed = false;
        this._state = MascotState.SLEEPING;
        this._codexActive = false;
        this._popupOpen = false;
        this._displayEnabled = true;
        this._postCloseDelayMs = MASCOT_POST_CLOSE_AWAKE_MS;
        this._sleepDelayMs = 0;
        this._animationAllowed = null;
        this._activeFrame = 0;
        this._lastActiveSequence = -1;
        this._sequenceGeneration = 0;
        this._activeId = 0;
        this._sleepId = 0;
        this._postCloseId = 0;
        this._icons = new Map();
        for (const name of FRAME_NAMES)
            this._icons.set(name, Gio.icon_new_for_string(mascotPath(extension, name)));

        this.actor = mascotIcon(
            extension,
            'robot-sleep.svg',
            size,
            'shadow-panel-mascot'
        );
        this._currentFrame = 'robot-sleep.svg';
        this._actorDestroyId = this.actor.connect('destroy', () => {
            this._actorDestroyId = 0;
            this._destroy(false);
        });

        this._settingsId = settings.connect('changed::animated-mascot', () =>
            this._syncAnimationPreference());
        this._animationsId = settings.connect('changed::animations', () =>
            this._syncAnimationPreference());
        this._shellSettings = St.Settings.get();
        this._shellAnimationsId = this._shellSettings.connect(
            'notify::enable-animations',
            () => this._syncAnimationPreference()
        );
        this._syncAnimationPreference();
    }

    _animationsEnabled() {
        return this._settings.get_boolean('animated-mascot') &&
            this._settings.get_boolean('animations') &&
            this._shellSettings.enable_animations;
    }

    _syncAnimationPreference() {
        if (!this._destroyed)
            this.setAnimationsEnabled(this._animationsEnabled());
    }

    setAnimationsEnabled(enabled) {
        const next = Boolean(enabled);
        if (this._animationAllowed === next)
            return;
        this._animationAllowed = next;
        this._cancelMotion();
        this._reconcileSemanticState();
    }

    setDisplayEnabled(enabled) {
        const next = Boolean(enabled);
        if (this._displayEnabled === next)
            return;
        this._displayEnabled = next;
        this._cancelMotion();
        this._reconcileSemanticState();
    }

    setState(state) {
        const active = state === MascotState.ACTIVE;
        if (this._codexActive === active)
            return;
        this._codexActive = active;
        if (active) {
            this._clearPostCloseTimer();
            this._enterActive();
        } else {
            this._enterAwake();
            if (!this._popupOpen)
                this._schedulePostCloseSleep();
        }
    }

    setPopupOpen(open) {
        const next = Boolean(open);
        if (this._popupOpen === next)
            return;
        this._popupOpen = next;
        if (next) {
            this._clearPostCloseTimer();
            if (this._codexActive)
                this._enterActive();
            else if (this._state === MascotState.SLEEPING ||
                this._state === MascotState.GOING_TO_SLEEP)
                this._enterWaking();
            else if (this._state !== MascotState.WAKING)
                this._enterAwake();
        } else if (!this._codexActive) {
            if (this._state !== MascotState.WAKING)
                this._enterAwake();
            this._schedulePostCloseSleep();
        }
    }

    _canMove() {
        return this._animationAllowed && this._displayEnabled && !this._destroyed;
    }

    _reconcileSemanticState() {
        if (this._destroyed)
            return;
        if (this._codexActive) {
            this._enterActive();
        } else if (this._popupOpen || this._postCloseId) {
            this._setVisualState(MascotState.AWAKE, 'robot-awake.svg');
        } else {
            this._enterSleeping();
        }
    }

    _enterWaking() {
        this._cancelMotion();
        if (!this._canMove()) {
            this._setVisualState(MascotState.AWAKE, 'robot-awake.svg');
            return;
        }
        this._state = MascotState.WAKING;
        this._playSequence(WAKE_SEQUENCE, () => {
            if (this._codexActive)
                this._enterActive();
            else
                this._enterAwake();
        });
    }

    _enterAwake() {
        this._cancelMotion();
        this._setVisualState(MascotState.AWAKE, 'robot-awake.svg');
    }

    _enterActive() {
        this._cancelMotion();
        this._state = MascotState.ACTIVE;
        if (!this._canMove()) {
            this._show('robot-active-11.svg');
            return;
        }
        this._startActiveSequence();
    }

    _enterGoingToSleep() {
        if (this._codexActive) {
            this._enterActive();
            return;
        }
        if (this._popupOpen) {
            this._enterAwake();
            return;
        }
        this._cancelMotion();
        if (!this._canMove()) {
            this._enterSleeping();
            return;
        }
        this._state = MascotState.GOING_TO_SLEEP;
        this._playSequence(SLEEP_SEQUENCE, () => this._enterSleeping());
    }

    _enterSleeping() {
        this._cancelMotion();
        this._setVisualState(MascotState.SLEEPING, 'robot-sleep.svg');
        this._scheduleSleepMotion();
    }

    _setVisualState(state, frame) {
        this._state = state;
        this._show(frame);
    }

    _playSequence(sequence, onComplete) {
        const generation = ++this._sequenceGeneration;
        let index = 0;
        const advance = () => {
            if (this._destroyed || generation !== this._sequenceGeneration)
                return;
            if (index >= sequence.length) {
                this._activeId = 0;
                onComplete?.();
                return;
            }
            const [frame, duration] = sequence[index++];
            this._activeFrame++;
            this._show(frame);
            this._activeId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                duration,
                () => {
                    this._activeId = 0;
                    advance();
                    return GLib.SOURCE_REMOVE;
                }
            );
        };
        advance();
    }

    _startActiveSequence() {
        if (!this._codexActive || this._state !== MascotState.ACTIVE || !this._canMove())
            return;
        let sequenceIndex = Math.floor(Math.random() * ACTIVE_SEQUENCES.length);
        if (ACTIVE_SEQUENCES.length > 1 && sequenceIndex === this._lastActiveSequence)
            sequenceIndex = (sequenceIndex + 1) % ACTIVE_SEQUENCES.length;
        this._lastActiveSequence = sequenceIndex;
        this._playSequence(ACTIVE_SEQUENCES[sequenceIndex], () => {
            if (this._codexActive && this._state === MascotState.ACTIVE && this._canMove())
                this._startActiveSequence();
        });
    }

    _scheduleSleepMotion() {
        if (!this._canMove() || this._state !== MascotState.SLEEPING)
            return;
        const spread = MASCOT_SLEEP_MAX_MS - MASCOT_SLEEP_MIN_MS;
        const delay = MASCOT_SLEEP_MIN_MS + Math.floor(Math.random() * (spread + 1));
        this._sleepDelayMs = delay;
        this._sleepId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, delay, () => {
            this._sleepId = 0;
            if (this._state !== MascotState.SLEEPING || !this._canMove())
                return GLib.SOURCE_REMOVE;
            const twitch = Math.random() < 0.35;
            const sequence = twitch
                ? [['robot-sleep-twitch.svg', 180], ['robot-sleep.svg', 180]]
                : [['robot-sleep-breathe.svg', 320], ['robot-sleep.svg', 260]];
            this._playSequence(sequence, () => this._scheduleSleepMotion());
            return GLib.SOURCE_REMOVE;
        });
    }

    _schedulePostCloseSleep() {
        this._clearPostCloseTimer();
        this._postCloseId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            this._postCloseDelayMs,
            () => {
                this._postCloseId = 0;
                if (!this._destroyed && !this._codexActive && !this._popupOpen)
                    this._enterGoingToSleep();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _show(name) {
        if (!this._destroyed && this.actor) {
            this.actor.gicon = this._icons.get(name);
            this._currentFrame = name;
        }
    }

    _clearMotionTimer() {
        this._sequenceGeneration++;
        if (this._activeId)
            GLib.Source.remove(this._activeId);
        this._activeId = 0;
    }

    _clearSleepTimer() {
        if (this._sleepId)
            GLib.Source.remove(this._sleepId);
        this._sleepId = 0;
    }

    _clearPostCloseTimer() {
        if (this._postCloseId)
            GLib.Source.remove(this._postCloseId);
        this._postCloseId = 0;
    }

    _cancelMotion() {
        this._clearMotionTimer();
        this._clearSleepTimer();
    }

    _clearTimers() {
        this._cancelMotion();
        this._clearPostCloseTimer();
    }

    destroy() {
        this._destroy(true);
    }

    _destroy(destroyActor) {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._clearTimers();
        if (this._settingsId)
            this._settings.disconnect(this._settingsId);
        if (this._animationsId)
            this._settings.disconnect(this._animationsId);
        if (this._shellAnimationsId)
            this._shellSettings.disconnect(this._shellAnimationsId);
        this._settingsId = 0;
        this._animationsId = 0;
        this._shellAnimationsId = 0;
        this._shellSettings = null;
        this._settings = null;
        this._icons.clear();
        const actor = this.actor;
        this.actor = null;
        if (destroyActor && actor) {
            if (this._actorDestroyId)
                actor.disconnect(this._actorDestroyId);
            this._actorDestroyId = 0;
            actor.destroy();
        }
        this._extension = null;
    }
}
