import styles from "./consent.module.css";

/** A number that counts up with CSS alone (and just shows the value under reduced motion). A visually hidden copy is what assistive tech reads. */
export function CountUp({ value }: { value: number }) {
  return (
    <>
      <span className={styles.countUp} style={{ ["--consent-n" as string]: value }} aria-hidden="true" />
      <span className="sr-only">{value}</span>
    </>
  );
}
