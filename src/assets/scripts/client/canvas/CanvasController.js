import $ from 'jquery';
import _cloneDeep from 'lodash/cloneDeep';
import _forEach from 'lodash/forEach';
import _has from 'lodash/has';
import _filter from 'lodash/filter';
import EventBus from '../lib/EventBus';
import {
    degreesToRadians,
    km,
    km_to_px
} from '../utilities/unitConverters';
import {
    sin,
    cos,
    round,
    calculateMiddle,
    extrapolate_range_clamp,
    clamp
} from '../math/core';
import {
    positive_intersection_with_rect,
    vectorize_2d,
    vscale
} from '../math/vector';
import { time } from '../utilities/timeHelpers';
import { tau } from '../math/circle';
import { distance2d } from '../math/distance';
import {
    FLIGHT_PHASE,
    FLIGHT_CATEGORY
} from '../constants/aircraftConstants';
import {
    BASE_CANVAS_FONT,
    DEFAULT_CANVAS_SIZE
} from '../constants/canvasConstants';
import { EVENT } from '../constants/eventNames';
import { SELECTORS } from '../constants/selectors';
import { LOG } from '../constants/logLevel';
import { TIME } from '../constants/globalConstants';
import { COLOR } from '../constants/colors/colors';
import { THEME } from '../constants/colors/themes';

// Temporary const declaration here to attach to the window AND use as internal property
const canvas = {};

/**
 * @class CanvasController
 */
export default class ConvasController {
    /**
     * @constructor
     * @param $element {JQuery|HTML Element|undefined}
     * @param navigationLibrary {NavigationLibrary}
     * @param gameController {GameController}
     */
    constructor($element, navigationLibrary, gameController) {
        this.$window = $(window);
        this.$element = $element;

        this._navigationLibrary = navigationLibrary;
        this._eventBus = EventBus;

        this._gameController = gameController;

        prop.canvas = canvas;
        this.canvas = canvas;
        this.canvas.contexts = {};
        this.canvas.panY = 0;
        this.canvas.panX = 0;
        // resize canvas to fit window?
        this.canvas.resize = true;
        // all canvases are the same size
        this.canvas.size = {
            height: DEFAULT_CANVAS_SIZE.HEIGHT,
            width: DEFAULT_CANVAS_SIZE.WIDTH
        };
        this.canvas.last = time();
        this.canvas.dirty = true;
        this.canvas.draw_labels = true;
        this.canvas.draw_restricted = true;
        this.canvas.draw_sids = true;
        this.canvas.draw_terrain = true;

        this.theme = THEME.DEFAULT;

        return this._init()
            .enable();
    }

    /**
     * @for CanvasController
     * @method _init
     */
    _init() {
        return this;
    }

    /**
     * @for CanvasController
     * @method enable
     */
    enable() {
        this._eventBus.on(EVENT.REQUEST_TO_CENTER_POINT_IN_VIEW, this._onCenterPointInView);

        return this;
    }

    /**
     * @for CanvasController
     * @method disable
     */
    disable() {
        return this.destroy();
    }

    /**
     * @for CanvasController
     * @method destroy
     */
    destroy() {
        this.$window = null;
        this.$element = null;
        this.canvas = {};
        this.canvas.contexts = {};
        this.canvas.panY = 0;
        this.canvas.panX = 0;
        // resize canvas to fit window?
        this.canvas.resize = true;
        // all canvases are the same size
        this.canvas.size = {
            height: DEFAULT_CANVAS_SIZE.HEIGHT,
            width: DEFAULT_CANVAS_SIZE.WIDTH
        };
        this.canvas.last = time();
        this.canvas.dirty = true;
        this.canvas.draw_labels = true;
        this.canvas.draw_restricted = true;
        this.canvas.draw_sids = true;
        this.canvas.draw_terrain = true;

        return this;
    }

    /**
     * @for CanvasController
     * @method canvas_init_pre
     */
    canvas_init_pre() {
        return this;
    }

    /**
     * @for CanvasController
     * @method canvas_init
     */
    canvas_init() {
        this.canvas_add('navaids');
    }

    /**
     * @for CanvasController
     * @method canvas_adjust_hidpi
     */
    canvas_adjust_hidpi() {
        const dpr = window.devicePixelRatio || 1;

        log(`devicePixelRatio: ${dpr}`);

        // TODO: change to early return
        if (dpr <= 1) {
            return;
        }

        // TODO: cache this selector, $hidefCanvas
        // TODO: replace selector with constant
        const hidefCanvas = $(SELECTORS.DOM_SELECTORS.NAVAIDS_CANVAS).get(0);
        const w = this.canvas.size.width;
        const h = this.canvas.size.height;

        $(hidefCanvas).attr('width', w * dpr);
        $(hidefCanvas).attr('height', h * dpr);
        $(hidefCanvas).css('width', w);
        $(hidefCanvas).css('height', h);

        const ctx = hidefCanvas.getContext('2d');

        ctx.scale(dpr, dpr);
        this.canvas.contexts.navaids = ctx;
    }

    /**
     * @for CanvasController
     * @method
     */
    canvas_complete() {
        setTimeout(() => {
            this.canvas.dirty = true;
        }, 500);

        this.canvas.last = time();
    }

    /**
     * @for CanvasController
     * @method
     */
    canvas_resize() {
        if (this.canvas.resize) {
            this.canvas.size.width = this.$window.width();
            this.canvas.size.height = this.$window.height();
        }

        // this.canvas.size.width -= 400;
        this.canvas.size.height -= 36;

        _forEach(this.canvas.contexts, (context) => {
            context.canvas.height = this.canvas.size.height;
            context.canvas.width = this.canvas.size.width;
        });

        this.canvas.dirty = true;
        this.canvas_adjust_hidpi();
    }

    /**
     * @for CanvasController
     * @method canvas_update_post
     */
    canvas_update_post() {
        const elapsed = window.gameController.game_time() - window.airportController.airport_get().start;
        const alpha = extrapolate_range_clamp(0.1, elapsed, 0.4, 0, 1);
        const framestep = Math.round(extrapolate_range_clamp(1, window.gameController.game.speedup, 10, 30, 1));

        if (this.canvas.dirty || (!window.gameController.game_paused() && prop.time.frames % framestep === 0) || elapsed < 1) {
            const cc = this.canvas_get('navaids');
            const fading = elapsed < 1;

            cc.font = '11px monoOne, monospace';

            // TODO: what is the rationale here? with two ors and a true, this block will always be exectuted.
            if (this.canvas.dirty || fading || true) {
                cc.save();

                this.canvas_clear(cc);

                cc.translate(
                    calculateMiddle(this.canvas.size.width),
                    calculateMiddle(this.canvas.size.height)
                );

                cc.save();
                cc.globalAlpha = alpha;

                this.canvas_draw_videoMap(cc);
                this.canvas_draw_terrain(cc);
                this.canvas_draw_restricted(cc);
                this.canvas_draw_runways(cc);
                cc.restore();

                cc.save();
                cc.globalAlpha = alpha;
                this.canvas_draw_fixes(cc);
                this.canvas_draw_sids(cc);
                cc.restore();


                cc.restore();
            }

            // Controlled traffic region - (CTR)
            cc.save();
            // translate to airport center
            cc.translate(
                round(this.canvas.size.width / 2 + this.canvas.panX),
                round(this.canvas.size.height / 2 + this.canvas.panY)
            );
            // TODO: this is incorrect usage of a ternary. ternaries should be used for a ssignment not function calls.
            // draw airspace border
            window.airportController.airport_get().airspace
                ? this.canvas_draw_airspace_border(cc)
                : this.canvas_draw_ctr(cc);

            this.canvas_draw_range_rings(cc);
            cc.restore();

            // Special markings for ENGM point merge
            if (window.airportController.airport_get().icao === 'ENGM') {
                cc.save();
                cc.translate(
                    calculateMiddle(this.canvas.size.width),
                    calculateMiddle(this.canvas.size.height)
                );
                this.canvas_draw_engm_range_rings(cc);
                cc.restore();
            }

            // Compass
            cc.font = 'bold 10px monoOne, monospace';

            if (this.canvas.dirty || fading || true) {
                cc.save();
                cc.translate(
                    calculateMiddle(this.canvas.size.width),
                    calculateMiddle(this.canvas.size.height)
                );

                this.canvas_draw_compass(cc);
                cc.restore();
            }

            cc.font = BASE_CANVAS_FONT;

            if (this.canvas.dirty || this.canvas_should_draw() || true) {
                cc.save();
                cc.globalAlpha = alpha;
                cc.translate(
                    calculateMiddle(this.canvas.size.width),
                    calculateMiddle(this.canvas.size.height)
                );
                this.canvas_draw_all_aircraft(cc);
                cc.restore();
            }

            cc.save();
            cc.globalAlpha = alpha;
            cc.translate(
                calculateMiddle(this.canvas.size.width),
                calculateMiddle(this.canvas.size.height)
            );
            this.canvas_draw_all_info(cc);
            cc.restore();

            cc.save();
            cc.globalAlpha = alpha;
            cc.translate(
                calculateMiddle(this.canvas.size.width),
                calculateMiddle(this.canvas.size.height)
            );

            this.canvas_draw_runway_labels(cc);
            cc.restore();

            cc.save();
            cc.globalAlpha = alpha;
            this.canvas_draw_scale(cc);
            cc.restore();

            cc.save();
            cc.globalAlpha = alpha;
            this.canvas_draw_directions(cc);
            cc.restore();

            this.canvas.dirty = false;
        }
    }

    /**
     * @for CanvasController
     * @method canvas_add
     * @param name {string}
     */
    canvas_add(name) {
        $(SELECTORS.DOM_SELECTORS.CANVASES).append(`<canvas id='${name}-canvas'></canvas>`);
        this.canvas.contexts[name] = $(`#${name}-canvas`).get(0).getContext('2d');
    }


    /**
     * @for CanvasController
     * @method canvas_get
     * @param name {string}
     */
    canvas_get(name) {
        return this.canvas.contexts[name];
    }

    /**
     * @for CanvasController
     * @method canvas_clear
     * @param cc {object}
     */
    canvas_clear(cc) {
        cc.clearRect(0, 0, this.canvas.size.width, this.canvas.size.height);
    }

    /**
     * @for CanvasController
     * @method canvas_should_draw
     */
    canvas_should_draw() {
        const elapsed = time() - this.canvas.last;

        if (elapsed > (1 / window.gameController.game.speedup)) {
            this.canvas.last = time();
            return true;
        }

        return false;
    }

    /**
     * @for CanvasController
     * @method canvas_draw_runway
     * @param cc
     * @param runway
     * @param mode
     */
    canvas_draw_runway(cc, runway, mode) {
        const length2 = round(window.uiController.km_to_px(runway.length / 2));
        const angle = runway.angle;

        cc.translate(
            round(window.uiController.km_to_px(runway.relativePosition[0])) + this.canvas.panX,
            -round(window.uiController.km_to_px(runway.relativePosition[1])) + this.canvas.panY
        );
        cc.rotate(angle);

        // runway body
        if (!mode) {
            cc.strokeStyle = '#899';
            cc.lineWidth = 2.8;

            cc.beginPath();
            cc.moveTo(0, 0);
            cc.lineTo(0, -2 * length2);
            cc.stroke();
        } else {
            // extended centerlines
            if (!runway.ils.enabled) {
                return;
            }

            cc.strokeStyle = this.theme.RUNWAY_EXTENDED_CENTERLINE;
            cc.lineWidth = 1;

            cc.beginPath();
            cc.moveTo(0, 0);
            cc.lineTo(0, window.uiController.km_to_px(runway.ils.loc_maxDist));
            cc.stroke();
        }
    }

    /**
     * @for CanvasController
     * @method canvas_draw_runway_label
     * @param cc
     * @param runway
     */
    canvas_draw_runway_label(cc, runway) {
        const length2 = round(window.uiController.km_to_px(runway.length / 2)) + 0.5;
        const angle = runway.angle;
        const text_height = 14;

        cc.translate(
            round(window.uiController.km_to_px(runway.relativePosition[0])) + this.canvas.panX,
            -round(window.uiController.km_to_px(runway.relativePosition[1])) + this.canvas.panY
        );
        cc.rotate(angle);

        cc.textAlign = 'center';
        cc.textBaseline = 'middle';

        cc.save();
        cc.translate(
            0,
            length2 + text_height
        );
        cc.rotate(-angle);
        cc.translate(
            round(window.uiController.km_to_px(runway.labelPos[0])),
            -round(window.uiController.km_to_px(runway.labelPos[1]))
        );
        cc.fillText(runway.name, 0, 0);
        cc.restore();
    }

    /**
     * @for CanvasController
     * @method canvas_draw_runways
     * @param cc
     */
    canvas_draw_runways(cc) {
        if (!this.canvas.draw_labels) {
            return;
        }

        cc.strokeStyle = this.theme.RUNWAY;
        cc.fillStyle = this.theme.RUNWAY;
        cc.lineWidth = 4;

        const airport = window.airportController.airport_get();

        // Extended Centerlines
        for (let i = 0; i < airport.runways.length; i++) {
            cc.save();
            this.canvas_draw_runway(cc, airport.runways[i][0], true);
            cc.restore();

            cc.save();
            this.canvas_draw_runway(cc, airport.runways[i][1], true);
            cc.restore();
        }

        // Runways
        for (let i = 0; i < airport.runways.length; i++) {
            cc.save();
            this.canvas_draw_runway(cc, airport.runways[i][0], false);
            cc.restore();
        }
    }

    /**
     * @for CanvasController
     * @method canvas_draw_runway_labels
     * @param cc
     */
    canvas_draw_runway_labels(cc) {
        if (!this.canvas.draw_labels) {
            return;
        }

        cc.fillStyle = this.theme.RUNWAY_LABELS;

        const airport = window.airportController.airport_get();
        for (let i = 0; i < airport.runways.length; i++) {
            cc.save();
            this.canvas_draw_runway_label(cc, airport.runways[i][0]);
            cc.restore();
            cc.save();
            this.canvas_draw_runway_label(cc, airport.runways[i][1]);
            cc.restore();
        }
    }

    /**
     * @for CanvasController
     * @method canvas_draw_scale
     * @param cc
     */
    canvas_draw_scale(cc) {
        cc.fillStyle = this.theme.TOP_ROW_TEXT;
        cc.strokeStyle = this.theme.TOP_ROW_TEXT;

        const offset = 10;
        const height = 5;
        const length = round(1 / prop.ui.scale * 50);
        const px_length = round(window.uiController.km_to_px(length));

        cc.translate(0.5, 0.5);

        cc.lineWidth = 1;
        cc.moveTo(this.canvas.size.width - offset, offset);
        cc.lineTo(this.canvas.size.width - offset, offset + height);
        cc.lineTo(this.canvas.size.width - offset - px_length, offset + height);
        cc.lineTo(this.canvas.size.width - offset - px_length, offset);
        cc.stroke();

        cc.translate(-0.5, -0.5);

        cc.textAlign = 'center';
        cc.fillText(
            `${length} km`, this.canvas.size.width - offset - px_length * 0.5,
            offset + height + 17
        );
    }

    /**
     * @for CanvasController
     * @method canvas_draw_fix
     * @param cc
     * @param name
     * @param fix
     */
    canvas_draw_fix(cc, name, fix) {
        cc.beginPath();
        cc.moveTo(0, -5);
        cc.lineTo(4, 3);
        cc.lineTo(-4, 3);
        cc.closePath();
        cc.fill();
        // cc.stroke();

        cc.textAlign = 'center';
        cc.textBaseline = 'top';
        cc.fillText(name, 0, 6);
    }

    /**
     * @for CanvasController
     * @method canvas_draw_fixes
     * @param cc
     */
    canvas_draw_fixes(cc) {
        if (!this.canvas.draw_labels) {
            return;
        }

        cc.lineJoin = 'round';
        cc.font = BASE_CANVAS_FONT;

        _forEach(this._navigationLibrary.realFixes, (fix, i) => {
            cc.save();
            cc.translate(
                round(window.uiController.km_to_px(fix.relativePosition[0])) + this.canvas.panX,
                -round(window.uiController.km_to_px(fix.relativePosition[1])) + this.canvas.panY
            );

            cc.fillStyle = this.theme.FIX_FILL;
            cc.globalCompositeOperation = 'source-over';
            cc.lineWidth = 1;

            this.canvas_draw_fix(cc, fix.name, fix.relativePosition);

            cc.restore();
        });
    }

    // TODO: break this method up into smaller chunks
    /**
     * @for CanvasController
     * @method canvas_draw_sids
     * @param cc
     */
    canvas_draw_sids(cc) {
        if (!this.canvas.draw_sids) {
            return;
        }

        // Store the count of sid text drawn for a specific transition
        const text_at_point = [];

        cc.strokeStyle = this.theme.SID;
        cc.fillStyle = this.theme.SID;
        cc.setLineDash([1, 10]);
        cc.font = 'italic 14px monoOne, monospace';

        _forEach(this._navigationLibrary.sidLines, (sid) => {
            let write_sid_name = true;
            let fixX = null;
            let fixY = null;

            if (!_has(sid, 'draw')) {
                return;
            }

            _forEach(sid.draw, (fixList, i) => {
                let exit_name = null;

                for (let j = 0; j < fixList.length; j++) {
                    // write exitPoint name
                    if (fixList[j].indexOf('*') !== -1) {
                        exit_name = fixList[j].replace('*', '');
                        write_sid_name = false;
                    }

                    // TODO: this is duplicated in the if block above. need to consolidate
                    const fixName = fixList[j].replace('*', '');
                    let fix = this._navigationLibrary.getFixRelativePosition(fixName);

                    if (!fix) {
                        log(`Unable to draw line to '${fixList[j]}' because its position is not defined!`, LOG.WARNING);
                    }

                    fixX = window.uiController.km_to_px(fix[0]) + this.canvas.panX;
                    fixY = -window.uiController.km_to_px(fix[1]) + this.canvas.panY;

                    if (j === 0) {
                        cc.beginPath();
                        cc.moveTo(fixX, fixY);
                    } else {
                        cc.lineTo(fixX, fixY);
                    }
                }

                cc.stroke();

                if (exit_name) {
                    // Initialize count for this transition
                    if (isNaN(text_at_point[exit_name])) {
                        text_at_point[exit_name] = 0;
                    }

                    // Move the y point for drawing depending on how many sids we have drawn text for
                    // at this point already
                    const y_point = fixY + (15 * text_at_point[exit_name]);
                    cc.fillText(`${sid.identifier}.${exit_name}`, fixX + 10, y_point);

                    text_at_point[exit_name] += 1;  // Increment the count for this transition
                }
            });

            if (write_sid_name) {
                cc.fillText(sid.identifier, fixX + 10, fixY);
            }
        });
    }

    /**
     * Draw a trailing indicator 2.5 NM (4.6km) behind landing aircraft to help with traffic spacing
     *
     * @for CanvasController
     * @method canvas_draw_separation_indicator
     * @param cc
     * @param aircraft
     */
    canvas_draw_separation_indicator(cc, aircraft) {
        if (aircraft.category === FLIGHT_CATEGORY.DEPARTURE) {
            return;
        }

        const runway = aircraft.fms.currentRunway;
        const oppositeOfRunwayHeading = runway.angle + Math.PI;

        cc.strokeStyle = this.theme.TRAILING_SEPARATION_INDICATOR;
        cc.lineWidth = 3;
        cc.translate(
            window.uiController.km_to_px(aircraft.relativePosition[0]) + this.canvas.panX,
            -window.uiController.km_to_px(aircraft.relativePosition[1]) + this.canvas.panY
        );
        cc.rotate(oppositeOfRunwayHeading);
        cc.beginPath();
        cc.moveTo(-5, -window.uiController.km_to_px(5.556));  // 5.556km = 3.0nm
        cc.lineTo(+5, -window.uiController.km_to_px(5.556));  // 5.556km = 3.0nm
        cc.stroke();
    }

    /**
     * @for CanvasController
     * @method canvas_draw_aircraft_rings
     * @param cc
     * @param aircraft
     */
    canvas_draw_aircraft_rings(cc, aircraft) {
        const aircraftAlerts = aircraft.hasAlerts();

        cc.save();

        if (aircraftAlerts[0]) {
            if (aircraftAlerts[1]) {
                // red violation circle
                cc.strokeStyle = this.theme.RING_VIOLATION;
            } else {
                // white warning circle
                cc.strokeStyle = this.theme.RING_CONFLICT;
            }
        } else {
            cc.strokeStyle = cc.fillStyle;
        }

        cc.beginPath();
        cc.arc(0, 0, window.uiController.km_to_px(km(3)), 0, tau());  // 3nm RADIUS
        cc.stroke();
        cc.restore();
    }

    // TODO: This likely has no purpose, and should be removed.
    /**
     * @for CanvasController
     * @method canvas_draw_aircraft_departure_window
     * @param cc
     * @param aircraft
     */
    canvas_draw_aircraft_departure_window(cc, aircraft) {
        const angle = aircraft.destination - Math.PI / 2;

        cc.save();
        cc.strokeStyle = this.theme.RADAR_TARGET_PROJECTION_DEPARTURE;
        cc.beginPath();
        cc.arc(
            this.canvas.panX,
            this.canvas.panY,
            window.uiController.km_to_px(window.airportController.airport_get().ctr_radius),
            angle - 0.08726,
            angle + 0.08726);
        cc.stroke();
        cc.restore();
    }

    /**
     * @for CanvasController
     * @method canvas_draw_aircraft
     * @param cc
     * @param aircraft
     */
    canvas_draw_aircraft(cc, aircraft) {
        let match = false;

        // TODO: this does not appear to be in use, verify and remove
        // let almost_match = false;
        //
        // if (
        //     prop.input.callsign.length > 1 &&
        //     aircraft.matchCallsign(prop.input.callsign.substr(0, prop.input.callsign.length - 1))
        // ) {
        //     almost_match = true;
        // }

        if (prop.input.callsign.length > 0 && aircraft.matchCallsign(prop.input.callsign)) {
            match = true;
        }

        if (match && (aircraft.destination != null)) {
            this.canvas_draw_aircraft_departure_window(cc, aircraft);
        }

        if (!aircraft.isVisible()) {
            return;
        }

        const size = 3;
        // Trailling
        let trailling_length = 12;
        const dpr = window.devicePixelRatio || 1;

        if (dpr > 1) {
            trailling_length *= round(dpr);
        }

        cc.save();

        if (!aircraft.inside_ctr) {
            cc.fillStyle = this.theme.RADAR_TARGET_OUTSIDE_RANGE;
        } else {
            cc.fillStyle = this.theme.RADAR_TARGET_IN_RANGE;
        }

        const length = aircraft.relativePositionHistory.length;
        for (let i = 0; i < length; i++) {
            let alpha = 1 / (length - i);

            if (!aircraft.inside_ctr) {
                alpha = 0.3 / (length - i);
            }

            cc.globalAlpha = alpha;
            cc.fillRect(
                window.uiController.km_to_px(aircraft.relativePositionHistory[i][0]) + this.canvas.panX - 1,
                -window.uiController.km_to_px(aircraft.relativePositionHistory[i][1]) + this.canvas.panY - 1,
                2,
                2
            );
        }

        cc.restore();

        if (aircraft.relativePositionHistory.length > trailling_length) {
            aircraft.relativePositionHistory = aircraft.relativePositionHistory.slice(
                aircraft.relativePositionHistory.length - trailling_length, aircraft.relativePositionHistory.length
            );
        }

        if (aircraft.isEstablishedOnCourse()) {
            cc.save();
            this.canvas_draw_separation_indicator(cc, aircraft);
            cc.restore();
        }

        // TODO: if all these parens are actally needed, abstract this out to a function that can return a bool.
        // Aircraft
        // Draw the future path
        if ((window.gameController.game.option.get('drawProjectedPaths') === 'always') ||
          ((window.gameController.game.option.get('drawProjectedPaths') === 'selected') &&
           ((aircraft.warning || match) && !aircraft.isTaxiing()))
        ) {
            this.canvas_draw_future_track(cc, aircraft);
        }

        const alerts = aircraft.hasAlerts();

        cc.strokeStyle = cc.fillStyle;

        if (match) {
            cc.save();

            if (!aircraft.inside_ctr) {
                cc.fillStyle = this.theme.RADAR_TARGET_OUTSIDE_RANGE;
            } else {
                cc.fillStyle = this.theme.RADAR_TARGET_IN_RANGE;
            }

            const w = this.canvas.size.width / 2;
            const h = this.canvas.size.height / 2;

            cc.translate(
                clamp(-w, window.uiController.km_to_px(aircraft.relativePosition[0]) + this.canvas.panX, w),
                clamp(-h, -window.uiController.km_to_px(aircraft.relativePosition[1]) + this.canvas.panY, h)
            );

            cc.beginPath();
            cc.arc(0, 0, round(size * 1.5), 0, tau());
            cc.fill();

            cc.restore();
        }

        cc.translate(
            window.uiController.km_to_px(aircraft.relativePosition[0]) + this.canvas.panX,
            -window.uiController.km_to_px(aircraft.relativePosition[1]) + this.canvas.panY
        );

        this.canvas_draw_aircraft_vector_lines(cc, aircraft);

        if (aircraft.notice || alerts[0]) {
            this.canvas_draw_aircraft_rings(cc, aircraft);
        }

        cc.beginPath();
        cc.arc(0, 0, size, 0, tau());
        cc.fill();
    }

    /**
     * Draw aircraft vector lines (projected track lines or PTL)
     *
     * Note: These extend in front of aircraft a definable number of minutes
     *
     * @for CanvasController
     * @method canvas_draw_aircraft_vector_lines
     * @param cc {canvas}
     * @param aircraft {AircraftModel}
     */
    canvas_draw_aircraft_vector_lines(cc, aircraft) {
        if (aircraft.hit) {
            return;
        }
        cc.save();

        cc.fillStyle = this.theme.PROJECTED_TRACK_LINES;
        cc.strokeStyle = this.theme.PROJECTED_TRACK_LINES;

        const ptlLengthMultiplier = this._gameController.getPtlLength();
        const lineLengthInHours = ptlLengthMultiplier * TIME.ONE_MINUTE_IN_HOURS;
        const lineLength_km = km(aircraft.groundSpeed * lineLengthInHours);
        const groundTrackVector = vectorize_2d(aircraft.groundTrack);
        const scaledGroundTrackVector = vscale(groundTrackVector, lineLength_km);
        const screenPositionOffsetX = km_to_px(scaledGroundTrackVector[0], prop.ui.scale);
        const screenPositionOffsetY = km_to_px(scaledGroundTrackVector[1], prop.ui.scale);

        cc.beginPath();
        cc.moveTo(0, 0);
        cc.lineTo(screenPositionOffsetX, -screenPositionOffsetY);
        cc.stroke();
        cc.restore();
    }

    /**
     * Draw dashed line from last coordinate of future track through
     * any later requested fixes.
     *
     * @for CanvasController
     * @method canvas_draw_future_track_fixes
     * @param cc
     * @param aircraft
     * @param future_track
     */
    canvas_draw_future_track_fixes(cc, aircraft, future_track) {
        // this is currently not working correctly and not in use
        return;

        const waypointList = aircraft.fms.waypoints;

        if (waypointList.length <= 1) {
            return;
        }
k
        const start = future_track.length - 1;
        const x = window.uiController.km_to_px(future_track[start][0]) + this.canvas.panX;
        const y = -window.uiController.km_to_px(future_track[start][1]) + this.canvas.panY;

        cc.beginPath();
        cc.moveTo(x, y);
        cc.setLineDash([3, 10]);

        for (let i = 0; i < waypointList.length; i++) {
            const [x, y] = waypointList[i].relativePosition;
            const fx = window.uiController.km_to_px(x) + this.canvas.panX;
            const fy = -window.uiController.km_to_px(y) + this.canvas.panY;

            cc.lineTo(fx, fy);
        }

        cc.stroke();
    }

    /**
     * Run physics updates into the future, draw future track
     *
     * @for CanvasController
     * @method canvas_draw_future_track
     * @param cc
     * @param aircraft
     */
    canvas_draw_future_track(cc, aircraft) {
        let ils_locked;
        let lockedStroke;
        let was_locked = false;
        const future_track = [];
        const save_delta = window.gameController.game.delta;
        const fms_twin = _cloneDeep(aircraft.fms);
        const twin = _cloneDeep(aircraft);

        twin.fms = fms_twin;
        twin.projected = true;
        window.gameController.game.delta = 5;

        for (let i = 0; i < 60; i++) {
            twin.update();

            ils_locked = twin.isEstablishedOnCourse() && twin.fms.currentPhase === FLIGHT_PHASE.APPROACH;

            future_track.push([...twin.relativePosition, ils_locked]);

            if (ils_locked && twin.altitude < 500) {
                break;
            }
        }

        window.gameController.game.delta = save_delta;
        cc.save();

        // future track colors
        if (aircraft.category === FLIGHT_CATEGORY.DEPARTURE) {
            cc.strokeStyle = this.theme.RADAR_TARGET_PROJECTION_DEPARTURE;
        } else {
            cc.strokeStyle = this.theme.RADAR_TARGET_PROJECTION_ARRIVAL;
            lockedStroke = this.theme.RADAR_TARGET_ESTABLISHED_ON_APPROACH;
        }

        cc.globalCompositeOperation = 'screen';
        cc.lineWidth = 2;
        cc.beginPath();

        for (let i = 0; i < future_track.length; i++) {
            const track = future_track[i];
            ils_locked = track[2];

            const x = window.uiController.km_to_px(track[0]) + this.canvas.panX;
            const y = -window.uiController.km_to_px(track[1]) + this.canvas.panY;

            if (ils_locked && !was_locked) {
                cc.lineTo(x, y);
                // end the current path, start a new path with lockedStroke
                cc.stroke();
                cc.strokeStyle = lockedStroke;
                cc.lineWidth = 3;
                cc.beginPath();
                cc.moveTo(x, y);

                was_locked = true;

                continue;
            }

            if (i === 0) {
                cc.moveTo(x, y);
            } else {
                cc.lineTo(x, y);
            }
        }

        cc.stroke();
        this.canvas_draw_future_track_fixes(cc, twin, future_track);
        cc.restore();
    }

    /**
     * @for CanvasController
     * @method canvas_draw_all_aircraft
     * @param cc
     */
    canvas_draw_all_aircraft(cc) {
        // FIXME: How is this different from at line 793?
        cc.fillStyle = COLOR.LIGHT_SILVER;
        cc.strokeStyle = COLOR.LIGHT_SILVER;
        cc.lineWidth = 2;

        // console.time('canvas_draw_all_aircraft')
        for (let i = 0; i < prop.aircraft.list.length; i++) {
            cc.save();
            this.canvas_draw_aircraft(cc, prop.aircraft.list[i]);
            cc.restore();
        }
        // console.timeEnd('canvas_draw_all_aircraft')
    }

    /**
     * Draw an aircraft's data block
     * (box that contains callsign, altitude, speed)
     *
     * @for CanvasController
     * @method anvas_draw_info
     * @param cc
     * @param aircraft
     */
    canvas_draw_info(cc, aircraft) {
        if (!aircraft.isVisible()) {
            return;
        }

        // TODO: flip the logic here and return early to make code more readable.
        if (!aircraft.hit) {
            // Initial Setup
            cc.save();

            const cs = aircraft.callsign;
            const paddingLR = 5;
            // width of datablock (scales to fit callsign)
            const width = clamp(1, 5.8 * cs.length) + (paddingLR * 2);
            const width2 = width / 2;
            // height of datablock
            const height = 31;
            const height2 = height / 2;
            // width of colored bar
            const bar_width = 3;
            const bar_width2 = bar_width / 2;
            const ILS_enabled = aircraft.pilot.hasApproachClearance;
            const lock_size = height / 3;
            const lock_offset = lock_size / 8;
            const pi = Math.PI;
            const point1 = lock_size - bar_width2;
            let alt_trend_char = '';
            const a = point1 - lock_offset;
            const b = bar_width2;
            const clipping_mask_angle = Math.atan(b / a);
            // describes how far around to arc the arms of the ils lock case
            const pi_slice = pi / 24;
            let match = false;
            let almost_match = false;

            // Callsign Matching
            if (prop.input.callsign.length > 1 && aircraft.matchCallsign(prop.input.callsign.substr(0, prop.input.callsign.length - 1))) {
                almost_match = true;
            }

            if (prop.input.callsign.length > 0 && aircraft.matchCallsign(prop.input.callsign)) {
                match = true;
            }

            // set color, intensity, and style elements
            let red = this.theme.DATA_BLOCK.OUT_OF_RANGE.ARRIVAL_BAR;
            let green = this.theme.DATA_BLOCK.OUT_OF_RANGE.BACKGROUND;
            let blue = this.theme.DATA_BLOCK.OUT_OF_RANGE.DEPARTURE_BAR;
            let white = this.theme.DATA_BLOCK.OUT_OF_RANGE.TEXT;

            if (aircraft.inside_ctr) {
                red = this.theme.DATA_BLOCK.SELECTED.ARRIVAL_BAR;
                green = this.theme.DATA_BLOCK.SELECTED.BACKGROUND;
                blue = this.theme.DATA_BLOCK.SELECTED.DEPARTURE_BAR;
                white = this.theme.DATA_BLOCK.SELECTED.TEXT;
            }

            cc.textBaseline = 'middle';

            // Move to center of where the data block is to be drawn
            const ac_pos = [
                round(window.uiController.km_to_px(aircraft.relativePosition[0])) + this.canvas.panX,
                -round(window.uiController.km_to_px(aircraft.relativePosition[1])) + this.canvas.panY
            ];

            // game will move FDB to the appropriate position
            if (aircraft.datablockDir === -1) {
                if (-window.uiController.km_to_px(aircraft.relativePosition[1]) + this.canvas.size.height / 2 < height * 1.5) {
                    cc.translate(ac_pos[0], ac_pos[1] + height2 + 12);
                } else {
                    cc.translate(ac_pos[0], ac_pos[1] - height2 - 12);
                }
            } else {
                // user wants to specify FDB position
                const displacements = {
                    ctr: [0, 0],
                    360: [0, -height2 - 12],
                    45: [width2 + 8.5, -height2 - 8.5],
                    90: [width2 + bar_width2 + 12, 0],
                    135: [width2 + 8.5, height2 + 8.5],
                    180: [0, height2 + 12],
                    225: [-width2 - 8.5, height2 + 8.5],
                    270: [-width2 - bar_width2 - 12, 0],
                    315: [-width2 - 8.5, -height2 - 8.5]
                };

                cc.translate(
                    ac_pos[0] + displacements[aircraft.datablockDir][0],
                    ac_pos[1] + displacements[aircraft.datablockDir][1]
                );
            }

            // Draw datablock shapes
            if (!ILS_enabled) {
                // Standard Box
                cc.fillStyle = green;
                // Draw box
                cc.fillRect(-width2, -height2, width, height);
                cc.fillStyle = (aircraft.category === FLIGHT_CATEGORY.DEPARTURE) ? blue : red;
                // Draw colored bar
                cc.fillRect(-width2 - bar_width, -height2, bar_width, height);
            } else {
                // Box with ILS Lock Indicator
                cc.save();

                // Draw green part of box (excludes space where ILS Clearance Indicator juts in)
                cc.fillStyle = green;
                cc.beginPath();
                cc.moveTo(-width2, height2);  // bottom-left corner
                cc.lineTo(width2, height2);   // bottom-right corner
                cc.lineTo(width2, -height2);  // top-right corner
                cc.lineTo(-width2, -height2); // top-left corner
                cc.lineTo(-width2, -point1);  // begin side cutout
                cc.arc(-width2 - bar_width2, -lock_offset, lock_size / 2 + bar_width2, clipping_mask_angle - pi / 2, 0);
                cc.lineTo(-width2 + lock_size / 2, lock_offset);
                cc.arc(-width2 - bar_width2, lock_offset, lock_size / 2 + bar_width2, 0, pi / 2 - clipping_mask_angle);
                cc.closePath();
                cc.fill();

                // Draw ILS Clearance Indicator
                cc.translate(-width2 - bar_width2, 0);
                cc.lineWidth = bar_width;
                cc.strokeStyle = red;
                cc.beginPath(); // top arc start
                cc.arc(0, -lock_offset, lock_size / 2, -pi_slice, pi + pi_slice, true);
                cc.moveTo(0, -lock_size / 2);
                cc.lineTo(0, -height2);
                cc.stroke(); // top arc end
                cc.beginPath(); // bottom arc start
                cc.arc(0, lock_offset, lock_size / 2, pi_slice, pi - pi_slice);
                cc.moveTo(0, lock_size - bar_width);
                cc.lineTo(0, height2);
                cc.stroke();  // bottom arc end

                if (aircraft.isEstablishedOnCourse()) {
                    // Localizer Capture Indicator
                    cc.fillStyle = white;
                    cc.beginPath();
                    cc.arc(0, 0, lock_size / 5, 0, pi * 2);
                    cc.fill(); // Draw Localizer Capture Dot
                }

                cc.translate(width2 + bar_width2, 0);
                // unclear how this works...
                cc.beginPath(); // if removed, white lines appear on top of bottom half of lock case
                cc.stroke(); // if removed, white lines appear on top of bottom half of lock case

                cc.restore();
            }

            // Text
            const gap = 3;          // height of TOTAL vertical space between the rows (0 for touching)
            const lineheight = 4.5; // height of text row (used for spacing basis)
            const row1text = cs;
            const row2text = `${lpad(round(aircraft.altitude * 0.01), 3)} ${lpad(round(aircraft.groundSpeed * 0.1), 2)}`;

            // TODO: remove the if/else in favor of an initial assignment, and update with if condition
            if (aircraft.inside_ctr) {
                cc.fillStyle = this.theme.DATA_BLOCK.IN_RANGE.TEXT;
            } else {
                cc.fillStyle = this.theme.DATA_BLOCK.OUT_OF_RANGE.TEXT;
            }

            if (aircraft.trend === 0) {
                // small dash (symbola font)
                alt_trend_char = String.fromCodePoint(0x2011);
            } else if (aircraft.trend > 0) {
                alt_trend_char = String.fromCodePoint(0x1F851); // up arrow (symbola font)
            } else if (aircraft.trend < 0) {
                alt_trend_char = String.fromCodePoint(0x1F853); // down arrow (symbola font)
            }

            // Draw full datablock text
            cc.textAlign = 'left';
            cc.fillText(row1text, -width2 + paddingLR, -gap / 2 - lineheight);
            cc.fillText(row2text, -width2 + paddingLR, gap / 2 + lineheight);
            // Draw climb/level/descend symbol
            cc.font = '10px symbola'; // change font to the one with extended unicode characters
            cc.textAlign = 'center';
            cc.fillText(alt_trend_char, -width2 + paddingLR + 20.2, gap / 2 + lineheight - 0.25);
            cc.font = BASE_CANVAS_FONT;  // change back to normal font

            cc.restore();
        }
    }

    /**
     * @for CanvasController
     * @method canvas_draw_all_info
     * @param cc
     */
    canvas_draw_all_info(cc) {
        for (let i = 0; i < prop.aircraft.list.length; i++) {
            cc.save();
            this.canvas_draw_info(cc, prop.aircraft.list[i]);
            cc.restore();
        }
    }

    /**
     * @for CanvasController
     * @method canvas_draw_compass
     * @param cc
     */
    canvas_draw_compass(cc) {
        cc.translate(
            calculateMiddle(this.canvas.size.width),
            calculateMiddle(this.canvas.size.height)
        );

        const airport = window.airportController.airport_get();
        const size = 80;
        const size2 = size / 2;
        const padding = 16;
        const dot = 16;
        let windspeed_line;
        let highwind;

        // Shift compass location
        cc.translate(-size2 - padding, -size2 - padding);
        cc.lineWidth = 4;

        // Outer circle
        cc.fillStyle = this.theme.WIND_VANE.OUTER_RING_FILL;
        cc.beginPath();
        cc.arc(0, 0, size2, 0, tau());
        cc.fill();

        // Inner circle
        cc.lineWidth = 1;
        cc.beginPath();
        cc.arc(0, 0, dot / 2, 0, tau());
        cc.strokeStyle = this.theme.WIND_VANE.INNER_RING_STROKE;
        cc.stroke();

        // Wind Value
        cc.fillStyle = this.theme.WIND_VANE.WIND_SPEED_TEXT;
        cc.textAlign = 'center';
        cc.textBaseline = 'center';
        cc.font = '9px monoOne, monospace';
        cc.fillText(airport.wind.speed, 0, 3.8);
        cc.font = 'bold 10px monoOne, monospace';

        // Wind line
        if (airport.wind.speed > 8) {
            windspeed_line = airport.wind.speed / 2;
            highwind = true;
        } else {
            windspeed_line = airport.wind.speed;
            highwind = false;
        }

        cc.save();
        cc.translate(
            -dot / 2 * sin(airport.wind.angle),
            dot / 2 * cos(airport.wind.angle)
        );
        cc.beginPath();
        cc.moveTo(0, 0);
        cc.rotate(airport.wind.angle);
        cc.lineTo(0, extrapolate_range_clamp(0, windspeed_line, 15, 0, size2 - dot));

        // TODO: simplify. replace with initial assignment and re-assignment in if condition
        // Color wind line red for high-wind
        if (highwind) {
            cc.strokeStyle = this.theme.WIND_VANE.DIRECTION_LINE_GUSTY;
        } else {
            cc.strokeStyle = this.theme.WIND_VANE.DIRECTION_LINE;
        }

        cc.lineWidth = 2;
        cc.stroke();
        cc.restore();
        cc.fillStyle = this.theme.WIND_VANE.WIND_SPEED_TEXT;
        cc.textAlign = 'center';
        cc.textBaseline = 'top';

        for (let i = 90; i <= 360; i += 90) {
            cc.rotate(degreesToRadians(90));

            let angle;
            if (i === 90) {
                angle = `0${i}`;
            } else {
                angle = i;
            }

            cc.save();
            cc.fillText(angle, 0, -size2 + 4);
            cc.restore();
        }
    }

    /**
     * Draw circular airspace border
     *
     * @for CanvasController
     * @method anvas_draw_ctr
     * @param cc
     */
    canvas_draw_ctr(cc) {
        // Draw a gentle fill color with border within the bounds of the airport's ctr_radius
        cc.strokeStyle = this.theme.AIRSPACE_PERIMETER;
        cc.fillStyle = this.theme.AIRSPACE_FILL;
        cc.beginPath();
        cc.arc(0, 0, window.airportController.airport_get().ctr_radius * prop.ui.scale, 0, tau());
        cc.fill();
        cc.stroke();
    }

    /**
     * Draw polygonal airspace border
     *
     * @for CanvasController
     * @method anvas_draw_airspace_border
     * @param cc
     */
    canvas_draw_airspace_border(cc) {
        const airport = window.airportController.airport_get();
        if (!airport.airspace) {
            this.canvas_draw_ctr(cc);
        }

        // style
        cc.strokeStyle = this.theme.AIRSPACE_PERIMETER;
        cc.fillStyle = this.theme.AIRSPACE_FILL;

        // draw airspace
        for (let i = 0; i < airport.airspace.length; i++) {
            const poly = $.map(airport.perimeter.poly, (v) => {
                return [v.relativePosition];
            });

            this.canvas_draw_poly(cc, poly);
            cc.clip();
        }
    }

    /**
     * @for CanvasController
     * @method canvas_draw_fancy_rings
     * @param cc
     * @param fix_origin
     * @param fix1
     * @param fix2
     */
    canvas_draw_fancy_rings(cc, fix_origin, fix1, fix2) {
        const airport = window.airportController.airport_get();
        const origin = airport.getFixPosition(fix_origin);
        const f1 = airport.getFixPosition(fix1);
        const f2 = airport.getFixPosition(fix2);
        const minDist = Math.min(distance2d(origin, f1), distance2d(origin, f2));
        const halfPI = Math.PI / 2;
        const extend_ring = degreesToRadians(10);
        const start_angle = Math.atan2(f1[0] - origin[0], f1[1] - origin[1]) - halfPI - extend_ring;
        const end_angle = Math.atan2(f2[0] - origin[0], f2[1] - origin[1]) - halfPI + extend_ring;
        const x = round(window.uiController.km_to_px(origin[0])) + this.canvas.panX;
        const y = -round(window.uiController.km_to_px(origin[1])) + this.canvas.panY;
        // 5NM = 9.27km
        const radius = 9.27;

        for (let i = 0; i < 4; i++) {
            cc.beginPath();
            cc.arc(
                x,
                y,
                window.uiController.km_to_px(minDist - (i * radius)),
                start_angle, end_angle
            );

            cc.stroke();
        }
    }


    /**
     * @for CanvasController
     * @method canvas_draw_engm_range_rings
     * @param cc
     */
    // Draw range rings for ENGM airport to assist in point merge
    canvas_draw_engm_range_rings(cc) {
        cc.strokeStyle = this.theme.RANGE_RING_COLOR;
        cc.setLineDash([3, 6]);

        this.canvas_draw_fancy_rings(cc, 'BAVAD', 'GM428', 'GM432');
        this.canvas_draw_fancy_rings(cc, 'TITLA', 'GM418', 'GM422');
        this.canvas_draw_fancy_rings(cc, 'INSUV', 'GM403', 'GM416');
        this.canvas_draw_fancy_rings(cc, 'VALPU', 'GM410', 'GM402');
    }

    /**
     * @for CanvasController
     * @method canvas_draw_range_rings
     * @param cc
     */
    canvas_draw_range_rings(cc) {
        const airport = window.airportController.airport_get();
        // convert input param from nm to km
        const rangeRingRadius = km(airport.rr_radius_nm);

        // Fill up airport's ctr_radius with rings of the specified radius
        for (let i = 1; i * rangeRingRadius < airport.ctr_radius; i++) {
            cc.beginPath();
            cc.linewidth = 1;
            cc.arc(0, 0, rangeRingRadius * prop.ui.scale * i, 0, tau());
            cc.strokeStyle = this.theme.RANGE_RING_COLOR;
            cc.stroke();
        }
    }

    /**
     * @for CanvasController
     * @method canvas_draw_poly
     * @param cc
     * @param poly
     */
    canvas_draw_poly(cc, poly) {
        cc.beginPath();

        _forEach(poly, (singlePoly, v) => {
            cc.lineTo(
                window.uiController.km_to_px(singlePoly[0]),
                -window.uiController.km_to_px(singlePoly[1])
            );
        });

        cc.closePath();
        cc.stroke();
        cc.fill();
    }

    /**
     * @for CanvasController
     * @method canvas_draw_terrain
     * @param cc
     */
    canvas_draw_terrain(cc) {
        if (!this.canvas.draw_terrain) {
            return;
        }

        // FIXME: Does this even end up getting used? Convert to use of `this.theme`
        cc.strokeStyle = COLOR.WHITE_04;
        cc.fillStyle = COLOR.WHITE_02;
        cc.lineWidth = clamp(0.5, (prop.ui.scale / 10), 2);
        cc.lineJoin = 'round';

        const airport = window.airportController.airport_get();
        let max_elevation = 0;

        cc.save();
        cc.translate(this.canvas.panX, this.canvas.panY);

        $.each(airport.terrain || [], (elevation, terrainLevel) => {
            max_elevation = Math.max(max_elevation, elevation);
            const color = `rgba(${prop.ui.terrain.COLOR[elevation]}, `;

            cc.strokeStyle = `${color} ${prop.ui.terrain.BORDER_OPACITY})`;
            cc.fillStyle = `${color} ${prop.ui.terrain.FILL_OPACITY})`;

            _forEach(terrainLevel, (terrainGroup) => {
                cc.beginPath();

                _forEach(terrainGroup, (terrainItem) => {
                    // TODO: should this be a for/in? is it an array?
                    _forEach(terrainItem, (value, index) => {
                        // Loose equals is important here.
                        if (index === 0) {
                            cc.moveTo(
                                window.uiController.km_to_px(terrainItem[index][0]),
                                -window.uiController.km_to_px(terrainItem[index][1])
                            );
                        }

                        cc.lineTo(
                            window.uiController.km_to_px(terrainItem[index][0]),
                            -window.uiController.km_to_px(terrainItem[index][1])
                        );
                    });

                    cc.closePath();
                });

                cc.fill();
                cc.stroke();
            });
        });

        cc.restore();

        if (max_elevation === 0) {
            return;
        }

        const offset = 10;
        const width = this.canvas.size.width;
        const height = this.canvas.size.height;
        const box_width = 30;
        const box_height = 5;

        cc.font = BASE_CANVAS_FONT;
        cc.lineWidth = 1;

        for (let i = 1000; i <= max_elevation; i += 1000) {
            cc.save();
            // translate coordinates for every block to not use these X & Y twice in rect and text
            // .5 in X and Y coordinates are used to make 1px rectangle fit exactly into 1 px
            // and not be blurred
            cc.translate(
                width / 2 - 140.5 - (max_elevation - i) / 1000 * (box_width + 1),
                -height / 2 + offset + 0.5
            );
            cc.beginPath();
            cc.rect(0, 0, box_width - 1, box_height);
            cc.closePath();

            // in the map, terrain of higher levels has fill of all the lower levels
            // so we need to fill it below exactly as in the map
            for (let j = 0; j <= i; j += 1000) {
                cc.fillStyle = `rgba(${prop.ui.terrain.COLOR[j]}, ${prop.ui.terrain.FILL_OPACITY})`;
                cc.fill();
            }

            cc.strokeStyle = `rgba(${prop.ui.terrain.COLOR[i]}, ${prop.ui.terrain.BORDER_OPACITY})`;
            cc.stroke();

            // write elevation signs only for the outer elevations
            if (i === max_elevation || i === 1000) {
                cc.fillStyle = this.theme.COMPASS_TEXT;
                cc.textAlign = 'center';
                cc.textBaseline = 'top';
                cc.fillText(`${i}'`, box_width / 2 + 0.5, offset + 2);
            }

            cc.restore();
        }
    }

    /**
     * @for CanvasController
     * @method canvas_draw_restricted
     * @param cc
     */
    canvas_draw_restricted(cc) {
        if (!this.canvas.draw_restricted) {
            return;
        }

        cc.strokeStyle = this.theme.RESTRICTED_AIRSPACE;
        cc.lineWidth = Math.max(prop.ui.scale / 3, 2);
        cc.lineJoin = 'round';
        cc.font = BASE_CANVAS_FONT;

        const airport = window.airportController.airport_get();

        cc.save();
        cc.translate(this.canvas.panX, this.canvas.panY);

        _forEach(airport.restricted_areas, (area) => {
            cc.fillStyle = 'transparent';
            this.canvas_draw_poly(cc, area.coordinates);

            // FIXME: Is the restricted airspace EVER filled???
            cc.fillStyle = this.theme.RESTRICTED_AIRSPACE;
            cc.textAlign = 'center';
            cc.textBaseline = 'top';

            const height = (area.height === Infinity ? 'UNL' : 'FL' + Math.ceil(area.height / 1000) * 10);
            let height_shift = 0;

            if (area.name) {
                height_shift = -12;

                cc.fillText(
                    area.name,
                    round(window.uiController.km_to_px(area.center[0])),
                    -round(window.uiController.km_to_px(area.center[1]))
                );
            }

            cc.fillText(
                height,
                round(window.uiController.km_to_px(area.center[0])),
                height_shift - round(window.uiController.km_to_px(area.center[1]))
            );
        });

        cc.restore();
    }

    /**
     * @for CanvasController
     * @method canvas_draw_videoMap
     * @param cc
     */
    canvas_draw_videoMap(cc) {
        if (!_has(window.airportController.airport_get(), 'maps')) {
            return;
        }

        cc.strokeStyle = this.theme.VIDEO_MAP;
        cc.lineWidth = prop.ui.scale / 15;
        cc.lineJoin = 'round';
        cc.font = BASE_CANVAS_FONT;

        const airport = window.airportController.airport_get();
        const map = airport.maps.base;

        cc.save();
        cc.translate(this.canvas.panX, this.canvas.panY);

        _forEach(map, (mapItem, i) => {
            cc.moveTo(window.uiController.km_to_px(mapItem[0]), -window.uiController.km_to_px(mapItem[1]));
            // cc.beginPath();
            cc.lineTo(window.uiController.km_to_px(mapItem[2]), -window.uiController.km_to_px(mapItem[3]));
        });

        cc.stroke();
        cc.restore();
    }

    /** Draws crosshairs that point to the currently translated location

    /**
     * @for CanvasController
     * @method canvas_draw_crosshairs
     * @param cc
     */
    canvas_draw_crosshairs(cc) {
        cc.save();
        cc.strokeStyle = this.theme.CROSSHAIR_STROKE;
        cc.lineWidth = 3;
        cc.beginPath();
        cc.moveTo(-10, 0);
        cc.lineTo(10, 0);
        cc.stroke();
        cc.beginPath();
        cc.moveTo(0, -10);
        cc.lineTo(0, 10);
        cc.stroke();
        cc.restore();
    }

    /**
     * Draw the compass around the scope edge
     *
     * @for CanvasController
     * @method canvas_draw_directions
     * @param cc
     */
    canvas_draw_directions(cc) {
        if (window.gameController.game_paused()) {
            return;
        }

        const callsign = prop.input.callsign.toUpperCase();
        if (callsign.length === 0) {
            return;
        }

        // Get the selected aircraft.
        const aircraft = _filter(prop.aircraft.list, (p) => {
            return p.matchCallsign(callsign) && p.isVisible();
        })[0];

        if (!aircraft) {
            return;
        }

        const pos = this.to_canvas_pos(aircraft.relativePosition);
        const rectPos = [0, 0];
        const rectSize = [this.canvas.size.width, this.canvas.size.height];

        cc.save();
        cc.strokeStyle = this.theme.COMPASS_HASH;
        cc.fillStyle = this.theme.COMPASS_TEXT;
        cc.textAlign = 'center';
        cc.textBaseline = 'middle';

        for (let alpha = 0; alpha < 360; alpha++) {
            const dir = [
                sin(degreesToRadians(alpha)),
                -cos(degreesToRadians(alpha))
            ];

            const p = positive_intersection_with_rect(pos, dir, rectPos, rectSize);

            if (p) {
                const markLen = (alpha % 5 === 0 ?
                    (alpha % 10 === 0
                        ? 16
                        : 12)
                    : 8
                );
                const markWeight = (alpha % 30 === 0
                    ? 2
                    : 1
                );

                const dx = -markLen * dir[0];
                const dy = -markLen * dir[1];

                cc.lineWidth = markWeight;
                cc.beginPath();
                cc.moveTo(p[0], p[1]);

                const markX = p[0] + dx;
                const markY = p[1] + dy;

                cc.lineTo(markX, markY);
                cc.stroke();

                if (alpha % 10 === 0) {
                    cc.font = (alpha % 30 === 0
                        ? 'bold 10px monoOne, monospace'
                        : BASE_CANVAS_FONT);

                    const text = '' + alpha;
                    const textWidth = cc.measureText(text).width;

                    cc.fillText(
                        text,
                        markX - dir[0] * (textWidth / 2 + 4),
                        markY - dir[1] * 7);
                }
            }
        }

        cc.restore();
    }

    /**
     * @for CanvasController
     * @method to_canvas_
     * @param pos {}
     */
    to_canvas_pos(pos) {
        return [
            this.canvas.size.width / 2 + this.canvas.panX + km(pos[0]),
            this.canvas.size.height / 2 + this.canvas.panY - km(pos[1])
        ];
    }

    /**
     * Center a point in the view
     *
     * Used only for centering aircraft, this accepts
     * the x,y of an aircrafts relativePosition
     *
     * @for CanvasController
     * @method _onCenterPointInView
     * @param x {number}    relativePosition.x
     * @param y {number}    relativePosition.y
     */
    _onCenterPointInView = ({ x, y }) => {
        this.canvas.panX = 0 - round(window.uiController.km_to_px(x));
        this.canvas.panY = round(window.uiController.km_to_px(y));
        this.dirty = true;
    };
}
