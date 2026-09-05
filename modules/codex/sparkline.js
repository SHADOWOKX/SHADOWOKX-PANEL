import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {sparklineCoordinates} from '../../lib/sparkline.js';
import {attachTooltip} from '../../ui/components.js';

function accentRgb(accent) {
    const valid = /^#[0-9a-fA-F]{6}$/.test(accent ?? '') ? accent : '#f43f5e';
    return [
        Number.parseInt(valid.slice(1, 3), 16) / 255,
        Number.parseInt(valid.slice(3, 5), 16) / 255,
        Number.parseInt(valid.slice(5, 7), 16) / 255,
    ];
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function traceSeries(context, points, move = true) {
    if (move)
        context.moveTo(points[0].x, points[0].y);
    for (let index = 0; index < points.length - 1; index++) {
        const previous = points[Math.max(0, index - 1)];
        const current = points[index];
        const next = points[index + 1];
        const following = points[Math.min(points.length - 1, index + 2)];
        const width = next.x - current.x;
        const previousSpan = Math.max(1, next.x - previous.x);
        const followingSpan = Math.max(1, following.x - current.x);
        const lower = Math.min(current.y, next.y);
        const upper = Math.max(current.y, next.y);
        const currentSlope = (next.y - previous.y) / previousSpan;
        const nextSlope = (following.y - current.y) / followingSpan;
        context.curveTo(
            current.x + width / 3,
            clamp(current.y + currentSlope * width / 3, lower, upper),
            next.x - width / 3,
            clamp(next.y - nextSlope * width / 3, lower, upper),
            next.x,
            next.y
        );
    }
}

export function tokenSparkline(buckets, accent, animate = false, tooltipForPoint = null) {
    const chart = new St.Widget({
        style_class: 'shadow-token-sparkline',
        x_expand: true,
        height: 68,
        opacity: animate ? 0 : 255,
        layout_manager: new Clutter.FixedLayout(),
    });
    const area = new St.DrawingArea({height: 68});
    chart.add_child(area);
    const targets = normalizePointTargets(chart, buckets, tooltipForPoint);
    let hoveredIndex = -1;
    targets.forEach((target, index) => {
        target.connect('enter-event', () => {
            hoveredIndex = index;
            area.queue_repaint();
            return Clutter.EVENT_PROPAGATE;
        });
        target.connect('leave-event', () => {
            hoveredIndex = -1;
            area.queue_repaint();
            return Clutter.EVENT_PROPAGATE;
        });
    });
    const syncAllocation = () => {
        const width = chart.width;
        const height = chart.height;
        if (width <= 0 || height <= 0)
            return;
        area.set_size(width, height);
        const points = sparklineCoordinates(buckets, width, height, {x: 8, y: 9});
        targets.forEach((target, index) => {
            const point = points[index];
            if (!point)
                return;
            target.set_position(
                Math.max(0, Math.min(
                    width - target.width,
                    Math.round(point.x - target.width / 2)
                )),
                Math.max(0, Math.min(
                    height - target.height,
                    Math.round(point.y - target.height / 2)
                ))
            );
        });
    };
    chart.connect('notify::allocation', syncAllocation);
    if (animate) {
        const mappedId = chart.connect('notify::mapped', () => {
            if (!chart.mapped)
                return;
            chart.disconnect(mappedId);
            chart.ease({
                opacity: 255,
                duration: 160,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
    }
    area.connect('repaint', drawingArea => {
        const [width, height] = drawingArea.get_surface_size();
        const padding = {x: 8, y: 9};
        const points = sparklineCoordinates(buckets, width, height, padding);
        if (points.length < 2)
            return;
        const [red, green, blue] = accentRgb(accent);
        const context = drawingArea.get_context();
        try {
            const bottom = height - padding.y;
            // Three quiet reference lines retain the chart's absolute zero baseline.
            context.setSourceRGBA(0.5, 0.55, 0.6, 0.18);
            context.setLineWidth(1);
            for (const fraction of [0, 0.5, 1]) {
                const y = Math.round(padding.y + (bottom - padding.y) * fraction) + 0.5;
                context.moveTo(padding.x, y);
                context.lineTo(width - padding.x, y);
            }
            context.stroke();
            const fill = new Cairo.LinearGradient(0, padding.y, 0, bottom);
            fill.addColorStopRGBA(0, red, green, blue, 0.26);
            fill.addColorStopRGBA(0.55, red, green, blue, 0.10);
            fill.addColorStopRGBA(1, red, green, blue, 0);
            context.moveTo(points[0].x, bottom);
            context.lineTo(points[0].x, points[0].y);
            traceSeries(context, points, false);
            context.lineTo(points.at(-1).x, bottom);
            context.closePath();
            context.setSource(fill);
            context.fill();

            traceSeries(context, points);
            context.setSourceRGBA(red, green, blue, 0.94);
            context.setLineWidth(2.2);
            context.setLineJoin(Cairo.LineJoin.ROUND);
            context.setLineCap(Cairo.LineCap.ROUND);
            context.stroke();

            for (const point of points.slice(0, -1)) {
                context.arc(point.x, point.y, 1.6, 0, Math.PI * 2);
                context.setSourceRGBA(red, green, blue, 0.82);
                context.fill();
            }

            const focused = points[hoveredIndex];
            if (focused) {
                context.moveTo(focused.x, padding.y);
                context.lineTo(focused.x, bottom);
                context.setSourceRGBA(red, green, blue, 0.35);
                context.setLineWidth(1);
                context.stroke();
                context.arc(focused.x, focused.y, 5, 0, Math.PI * 2);
                context.setSourceRGBA(red, green, blue, 0.25);
                context.fill();
                context.arc(focused.x, focused.y, 2.5, 0, Math.PI * 2);
                context.setSourceRGBA(red, green, blue, 1);
                context.fill();
            }
            const last = points.at(-1);
            context.arc(last.x, last.y, 3.7, 0, Math.PI * 2);
            context.setSourceRGBA(red, green, blue, 0.18);
            context.fill();
            context.arc(last.x, last.y, 2, 0, Math.PI * 2);
            context.setSourceRGBA(red, green, blue, 1);
            context.fill();
        } finally {
            context.$dispose?.();
        }
    });
    return chart;
}

function normalizePointTargets(chart, buckets, tooltipForPoint) {
    if (typeof tooltipForPoint !== 'function')
        return [];
    return buckets.map(bucket => {
        const target = new St.Widget({
            style_class: 'shadow-token-point-target',
            width: 16,
            height: 16,
        });
        attachTooltip(target, () => tooltipForPoint(bucket));
        chart.add_child(target);
        return target;
    });
}
