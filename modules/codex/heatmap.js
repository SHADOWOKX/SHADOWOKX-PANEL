import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Pango from 'gi://Pango';

export function accountHeatmap(calendar, accent, describe) {
    const wrap = new St.BoxLayout({vertical: true, x_expand: true,
        style_class: 'shadow-activity-calendar'});
    const defaultCaption = calendar.mode === 'weekly'
        ? 'WEEKLY TOTALS · REPORTED ACCOUNT DAYS' : 'DAILY TOKENS · LAST 12 MONTHS';
    const caption = new St.Label({text: defaultCaption,
        style_class: 'shadow-chart-caption shadow-muted', x_align: Clutter.ActorAlign.START});
    caption.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    wrap.add_child(caption);
    const area = new St.DrawingArea({height: 54, x_expand: true,
        reactive: true, track_hover: true, can_focus: true,
        style_class: 'shadow-account-heatmap',
        accessible_name: `${calendar.activeDays} active ${calendar.mode === 'weekly' ? 'weeks' : 'days'} in ${calendar.reportedDays} reported account dates. Blank cells are not reported.`});
    wrap.add_child(area);
    const color = /^#[0-9a-f]{6}$/i.test(accent ?? '') ? accent : '#f43f5e';
    const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255);
    let hovered = -1;
    const geometry = width => {
        const rows = calendar.rows ?? 7;
        const columns = Math.max(1, calendar.columns);
        const weekly = calendar.mode === 'weekly';
        const gap = 1.5;
        const size = Math.max(1, Math.min(weekly ? 11 : 6.5, (width - 2 - gap * (columns - 1)) / columns));
        const stepX = size + gap;
        return {size, gap, stepX, x: (width - stepX * (columns - 1) - size) / 2,
            y: (54 - rows * size - (rows - 1) * gap) / 2};
    };
    const select = index => {
        const cell = calendar.cells[index];
        const next = cell?.inRange ? index : -1;
        if (next === hovered)
            return;
        hovered = next;
        caption.text = hovered < 0 ? defaultCaption : describe(cell);
        area.accessible_name = caption.text;
        area.queue_repaint();
    };
    area.connect('motion-event', (_actor, event) => {
        const [sx, sy] = area.get_transformed_position();
        const [sw, sh] = area.get_transformed_size();
        const [px, py] = event.get_coords();
        const {size, gap, stepX, x, y} = geometry(area.width);
        const lx = (px - sx) * area.width / Math.max(1, sw) - x;
        const ly = (py - sy) * area.height / Math.max(1, sh) - y;
        const column = Math.floor(lx / stepX);
        const row = Math.floor(ly / (size + gap));
        select(column >= 0 && column < calendar.columns && row >= 0 && row < (calendar.rows ?? 7) && lx % stepX <= size && ly % (size + gap) <= size
            ? column * (calendar.rows ?? 7) + row : -1);
        return Clutter.EVENT_PROPAGATE;
    });
    area.connect('leave-event', () => { select(-1); return Clutter.EVENT_PROPAGATE; });
    area.connect('key-press-event', (_actor, event) => {
        const key = event.get_key_symbol();
        const offset = key === Clutter.KEY_Left ? -(calendar.rows ?? 7) : key === Clutter.KEY_Right ? (calendar.rows ?? 7)
            : key === Clutter.KEY_Up ? -1 : key === Clutter.KEY_Down ? 1 : 0;
        if (!offset)
            return Clutter.EVENT_PROPAGATE;
        select(Math.max(0, Math.min(calendar.cells.length - 1,
            (hovered < 0 ? calendar.cells.findLastIndex(cell => cell.inRange) : hovered) + offset)));
        return Clutter.EVENT_STOP;
    });
    area.connect('repaint', drawing => {
        const [width] = drawing.get_surface_size();
        const {size, gap, stepX, x, y} = geometry(width);
        const context = drawing.get_context();
        try {
            for (const [index, cell] of calendar.cells.entries()) {
                if (!cell.inRange)
                    continue;
                const cx = x + cell.column * stepX;
                const cy = y + cell.row * (size + gap);
                const intensity = cell.tokens > 0 && calendar.peak?.tokens > 0
                    ? 0.30 + 0.70 * Math.sqrt(cell.tokens / calendar.peak.tokens) : 0;
                context.setSourceRGBA(...(intensity > 0 ? rgb : [0.5, 0.53, 0.5]),
                    intensity || (cell.tokens === 0 ? 0.24 : 0.10));
                const radius = Math.min(1.5, size / 3);
                context.newSubPath();
                context.arc(cx + size - radius, cy + radius, radius, -Math.PI / 2, 0);
                context.arc(cx + size - radius, cy + size - radius, radius, 0, Math.PI / 2);
                context.arc(cx + radius, cy + size - radius, radius, Math.PI / 2, Math.PI);
                context.arc(cx + radius, cy + radius, radius, Math.PI, Math.PI * 1.5);
                context.closePath();
                context.fill();
                if (index === hovered) {
                    context.setSourceRGBA(...rgb, 1);
                    context.setLineWidth(1);
                    context.rectangle(cx - 0.5, cy - 0.5, size + 1, size + 1);
                    context.stroke();
                }
            }
        } finally {
            context.$dispose?.();
        }
    });
    const timeline = new St.BoxLayout({height: 12, x_expand: true,
        style_class: 'shadow-activity-months'});
    for (const [index, month] of calendar.months.entries()) {
        const slot = new St.Bin({x_expand: true});
        slot.set_child(new St.Label({text: month.label, style_class: 'shadow-spark-day',
            x_align: calendar.mode === 'weekly' && index === 1
                ? Clutter.ActorAlign.END : Clutter.ActorAlign.START}));
        timeline.add_child(slot);
    }
    wrap.add_child(timeline);
    return wrap;
}
