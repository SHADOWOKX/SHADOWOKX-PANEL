import Cairo from 'cairo';
import St from 'gi://St';

import {sparklineCoordinates} from '../../lib/sparkline.js';

function accentRgb(accent) {
    const valid = /^#[0-9a-fA-F]{6}$/.test(accent ?? '') ? accent : '#f43f5e';
    return [
        Number.parseInt(valid.slice(1, 3), 16) / 255,
        Number.parseInt(valid.slice(3, 5), 16) / 255,
        Number.parseInt(valid.slice(5, 7), 16) / 255,
    ];
}

export function tokenSparkline(buckets, accent) {
    const area = new St.DrawingArea({
        style_class: 'shadow-token-sparkline',
        x_expand: true,
        height: 54,
    });
    area.connect('repaint', drawingArea => {
        const [width, height] = drawingArea.get_surface_size();
        const points = sparklineCoordinates(buckets, width, height, 5);
        if (points.length < 2)
            return;
        const [red, green, blue] = accentRgb(accent);
        const context = drawingArea.get_context();
        try {
            const bottom = height - 4;
            const fill = new Cairo.LinearGradient(0, 4, 0, bottom);
            fill.addColorStopRGBA(0, red, green, blue, 0.20);
            fill.addColorStopRGBA(1, red, green, blue, 0.015);
            context.moveTo(points[0].x, bottom);
            context.lineTo(points[0].x, points[0].y);
            for (const point of points.slice(1))
                context.lineTo(point.x, point.y);
            context.lineTo(points.at(-1).x, bottom);
            context.closePath();
            context.setSource(fill);
            context.fill();

            context.moveTo(points[0].x, points[0].y);
            for (const point of points.slice(1))
                context.lineTo(point.x, point.y);
            context.setSourceRGBA(red, green, blue, 0.94);
            context.setLineWidth(2);
            context.setLineJoin(Cairo.LineJoin.ROUND);
            context.setLineCap(Cairo.LineCap.ROUND);
            context.stroke();

            const last = points.at(-1);
            context.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
            context.setSourceRGBA(red, green, blue, 1);
            context.fill();
        } finally {
            context.$dispose?.();
        }
    });
    return area;
}
