import {
  WHEATMARK_CONTENT_VIEWBOX,
  WHEATMARK_SHAPES,
} from './wheatmarkGeometry';

interface WheatMarkProps {
  className?: string;
}

/**
 * The Grainwatch brand mark, drawn from the shared geometry so the header and
 * the installed app icon cannot drift apart.
 *
 * Uses the cropped viewBox, not the padded one the icon files need: the padding
 * exists for Android's mask, and inline it would only shrink the mark against
 * the icons beside it.
 *
 * Decorative: the header spells the product name out next to it, so announcing
 * the mark as well would only repeat that.
 */
export function WheatMark({ className }: WheatMarkProps) {
  return (
    <svg
      viewBox={WHEATMARK_CONTENT_VIEWBOX}
      className={className}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {WHEATMARK_SHAPES.map((shape, index) =>
        shape.kind === 'rect' ? (
          <rect
            key={index}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            rx={shape.rx}
          />
        ) : (
          <ellipse
            key={index}
            cx={shape.cx}
            cy={shape.cy}
            rx={shape.rx}
            ry={shape.ry}
            transform={
              shape.rotate === undefined
                ? undefined
                : `rotate(${shape.rotate} ${shape.cx} ${shape.cy})`
            }
          />
        )
      )}
    </svg>
  );
}
