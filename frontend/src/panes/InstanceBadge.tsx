import { useStore } from "../store";

/** Which NextTex this is, on a machine carrying more than one.
 *
 *  Nothing at all on an ordinary install -- almost everybody has one, and a
 *  badge reading "the normal one" is noise.  It appears only when the
 *  server was started with `--instance`, which is the case where opening
 *  the wrong tab and writing in it is a real and expensive mistake.
 *
 *  `--warn` rather than the accent: this is a caution, not a feature.
 */
export default function InstanceBadge() {
  const instance = useStore((s) => s.instance);
  if (!instance) return null;
  return (
    <span
      data-testid="instance-badge"
      title={`This is the "${instance}" install, not your main one`}
      className="t-micro shrink-0 rounded-[3px] border border-warn px-[5px] py-px uppercase tracking-wide text-warn"
    >
      {instance}
    </span>
  );
}
