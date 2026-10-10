/** Where a framed dialog sits in a frame of plain ASCII text, found by its title. */
export function dialogBounds(frame: string, title: string) {
  const lines = frame.split("\n");
  const top = lines.findIndex((line) => line.includes(title));
  const left = lines[top]?.indexOf("┌") ?? -1;
  const right = lines[top]?.lastIndexOf("┐") ?? -1;
  const bottom = lines.findIndex((line, row) => row > top && line[left] === "└");
  return {
    top,
    bottom,
    /** How far the rows above and below differ; at most 1 when centred. */
    vertical: Math.abs(top - (lines.length - 1 - bottom)),
    /** How far the columns left and right differ; at most 1 when centred. */
    horizontal: Math.abs(left - ((lines[top]?.length ?? 0) - 1 - right)),
  };
}
