import type { Product, Run } from "../../types";
import type { useProductEditor } from "./useProductEditor";

export type ProductEditorProps = {
  product: Product;
  tab: string;
  setTab: (t: string) => void;
  close: () => void;
  busy: boolean;
  run: Run;
  update: (p: Product) => void;
};
export type ProductEditorContext = ProductEditorProps &
  ReturnType<typeof useProductEditor>;
