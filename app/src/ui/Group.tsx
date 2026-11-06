/**
 * Grouped list container, from the prototype's `.group`. Rows inside get the
 * grouped padding (14 / 16) and a 1 dp line between them (`.group .row + .row`).
 */
import { Children, createContext, Fragment, type ReactNode, useContext } from "react";
import { View } from "react-native";
import { useTheme } from "./theme";

/** Set by `Group` so that `Row` uses the in-group padding. */
export const GroupContext = createContext(false);

export function useInGroup(): boolean {
  return useContext(GroupContext);
}

export interface GroupProps {
  children: ReactNode;
}

/** `.group`: 16 dp side margins, 18 radius, fill background, clipped. */
export function Group({ children }: GroupProps) {
  const t = useTheme().tokens;
  const items = Children.toArray(children);
  return (
    <GroupContext.Provider value={true}>
      <View
        style={{
          marginTop: 4,
          marginHorizontal: 16,
          borderRadius: 18,
          backgroundColor: t.fill,
          overflow: "hidden",
        }}
      >
        {items.map((child, index) => (
          <Fragment key={index}>
            {index > 0 ? <View style={{ height: 1, backgroundColor: t.line }} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
    </GroupContext.Provider>
  );
}
