import { defineWidgetConfig } from "@medusajs/admin-sdk";
import {
  Container,
  Text,
  Button,
  Drawer,
  Switch,
  Input,
  toast,
  DataTable,
  createDataTableColumnHelper,
  createDataTableCommandHelper,
  useDataTable,
  Badge,
} from "@medusajs/ui";
import type {
  AdminProduct,
  DetailWidgetProps,
} from "@medusajs/framework/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { sdk } from "../lib/client";

/**
 * Bulk engraving settings widget — product-level.
 *
 * Injected at product.details.after — renders a DataTable of all variants
 * with row selection. When variants are selected, a CommandBar appears with
 * a "Set Engraving" action that opens a Drawer for bulk-applying fee,
 * threshold, and eligibility.
 *
 * Coexists with the per-variant engraving widget at product_variant.details.after.
 * That widget is for fine-tuning a single variant; this one is for applying
 * the same settings to many variants at once.
 */

// ----- Types -----

interface VariantRow {
  id: string;
  title: string;
  sku: string | null;
  isEngravable: boolean;
  fee: number | null;
  threshold: number | null;
  currencyCode: string;
}

interface BulkFormState {
  is_engravable: boolean;
  engraving_fee: number | "";
  engraving_threshold: number | "";
}

// ----- Helpers -----

function toVariantRows(product: AdminProduct): VariantRow[] {
  return (product.variants ?? []).map((v: any) => {
    const meta = (v.metadata ?? {}) as Record<string, any>;
    const prices = (v.prices ?? []) as any[];
    const currencyCode =
      prices.length > 0 && prices[0].currency_code
        ? (prices[0].currency_code as string).toUpperCase()
        : "";
    return {
      id: v.id,
      title: v.title ?? "(untitled)",
      sku: (v.sku as string) ?? null,
      isEngravable: !!meta.is_engravable,
      fee: meta.is_engravable ? Number(meta.engraving_fee) || null : null,
      threshold: meta.is_engravable
        ? Number(meta.engraving_threshold) || null
        : null,
      currencyCode,
    };
  });
}

/**
 * Compute pre-fill values from selected variants.
 * If all selected variants share the same value → pre-fill with it.
 * If values differ → leave blank / off (don't silently overwrite).
 */
function computePreFill(rows: VariantRow[]): BulkFormState {
  if (rows.length === 0) {
    return { is_engravable: false, engraving_fee: "", engraving_threshold: "" };
  }

  const fees = new Set(rows.map((r) => r.fee));
  const thresholds = new Set(rows.map((r) => r.threshold));
  const engravable = new Set(rows.map((r) => r.isEngravable));

  return {
    is_engravable: engravable.size === 1 ? rows[0].isEngravable : false,
    engraving_fee: fees.size === 1 && rows[0].fee !== null ? rows[0].fee : "",
    engraving_threshold:
      thresholds.size === 1 && rows[0].threshold !== null
        ? rows[0].threshold
        : "",
  };
}

// ----- Column & Command helpers -----

const columnHelper = createDataTableColumnHelper<VariantRow>();
const commandHelper = createDataTableCommandHelper();

// ----- Component -----

const EngravingBulkWidget = ({
  data: product,
}: DetailWidgetProps<AdminProduct>) => {
  const queryClient = useQueryClient();

  // Fetch product with variants + prices expanded — the product detail page
  // prop explicitly excludes variants (fields: "-variants"), so we need a
  // separate query. Prices are expanded to detect the store currency.
  const {
    data: fullProduct,
    isLoading,
    isError,
  } = useQuery<{ product: AdminProduct }>({
    queryKey: ["product", product.id],
    queryFn: () =>
      sdk.client.fetch(
        `/admin/products/${product.id}?fields=*variants,*variants.prices`,
      ),
  });

  const variants = useMemo(
    () => (fullProduct ? toVariantRows(fullProduct.product) : []),
    [fullProduct],
  );

  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState<BulkFormState>({
    is_engravable: false,
    engraving_fee: "",
    engraving_threshold: "",
  });

  const selectedRows = useMemo(
    () => variants.filter((v) => rowSelection[v.id]),
    [variants, rowSelection],
  );

  // Which currencies are represented among the selected variants?
  const selectedCurrencies = useMemo(() => {
    const codes = new Set(
      selectedRows.map((r) => r.currencyCode).filter(Boolean),
    );
    return [...codes].sort();
  }, [selectedRows]);

  const canSave =
    !form.is_engravable ||
    (form.is_engravable &&
      form.engraving_fee !== "" &&
      Number(form.engraving_fee) > 0 &&
      form.engraving_threshold !== "" &&
      Number(form.engraving_threshold) >= 1);

  const saveMutation = useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/admin/products/${product.id}/engravable/bulk`, {
        method: "POST",
        body: {
          variant_ids: selectedRows.map((r) => r.id),
          is_engravable: form.is_engravable,
          engraving_fee: form.is_engravable
            ? Number(form.engraving_fee)
            : undefined,
          engraving_threshold: form.is_engravable
            ? Number(form.engraving_threshold)
            : undefined,
        },
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["product", product.id] });
      toast.success(`Engraving settings applied to ${data.count} variants`);
      setRowSelection({});
      setDrawerOpen(false);
    },
    onError: (error: any) => {
      const msg =
        error?.response?.data?.message ??
        error?.message ??
        "Failed to save engraving settings";
      toast.error(msg);
    },
  });

  // ----- DataTable columns -----

  const columns = [
    columnHelper.select(),
    columnHelper.accessor("title", {
      header: "Variant",
    }),
    columnHelper.accessor("sku", {
      header: "SKU",
      cell: ({ getValue }) => {
        const sku = getValue();
        return sku ? (
          <Text size="small" leading="compact">
            {sku}
          </Text>
        ) : (
          <Text size="small" leading="compact" className="text-ui-fg-muted">
            —
          </Text>
        );
      },
    }),
    columnHelper.accessor("isEngravable", {
      header: "Engraving",
      cell: ({ getValue, row }) => {
        const engravable = getValue();
        return engravable ? (
          <div className="flex flex-col gap-y-0.5">
            <Badge size="small" color="green">
              Engravable
            </Badge>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              {row.original.currencyCode
                ? `${row.original.currencyCode} ${row.original.fee?.toFixed(2)}`
                : row.original.fee?.toFixed(2)}{" "}
              / free over {row.original.threshold}
            </Text>
          </div>
        ) : (
          <Badge size="small" color="grey">
            Not engravable
          </Badge>
        );
      },
    }),
  ];

  // ----- Commands -----

  const commands = [
    commandHelper.command({
      label: "Set Engraving",
      shortcut: "E",
      action: () => {
        const preFill = computePreFill(selectedRows);
        setForm(preFill);
        setDrawerOpen(true);
      },
    }),
    commandHelper.command({
      label: "Clear Engraving",
      shortcut: "X",
      action: async () => {
        try {
          const res = await sdk.client.fetch(
            `/admin/products/${product.id}/engravable/bulk`,
            {
              method: "POST",
              body: {
                variant_ids: selectedRows.map((r) => r.id),
                is_engravable: false,
              },
            },
          );
          queryClient.invalidateQueries({ queryKey: ["product", product.id] });
          toast.success(`Engraving cleared on ${(res as any).count} variants`);
          setRowSelection({});
        } catch (error: any) {
          toast.error(error?.message ?? "Failed to clear engraving");
        }
      },
    }),
  ];

  // ----- DataTable instance -----

  const instance = useDataTable({
    data: variants,
    columns,
    getRowId: (row) => row.id,
    rowCount: variants.length,
    isLoading,
    commands,
    rowSelection: {
      state: rowSelection,
      onRowSelectionChange: setRowSelection,
    },
  });

  // ----- Render -----

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col gap-y-1">
          <Text size="small" leading="compact" weight="plus">
            Bulk Engraving Settings
          </Text>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Select variants to apply engraving eligibility, fee, and threshold
            in bulk
          </Text>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center px-6 py-12">
          <Text size="small" leading="compact" className="text-ui-fg-muted">
            Loading variants…
          </Text>
        </div>
      )}

      {isError && (
        <div className="flex items-center justify-center px-6 py-12">
          <Text size="small" leading="compact" className="text-ui-fg-error">
            Failed to load variants. Try refreshing the page.
          </Text>
        </div>
      )}

      {!isLoading && !isError && variants.length === 0 && (
        <div className="flex items-center justify-center px-6 py-12">
          <Text size="small" leading="compact" className="text-ui-fg-muted">
            This product has no variants.
          </Text>
        </div>
      )}

      {!isLoading && !isError && variants.length > 0 && (
        <DataTable instance={instance}>
          <DataTable.Table />
          <DataTable.CommandBar
            selectedLabel={(count: number) => `${count} selected`}
          />
        </DataTable>
      )}

      {/* Bulk-edit Drawer */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>
              Set Engraving — {selectedRows.length} variant
              {selectedRows.length !== 1 ? "s" : ""}
            </Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-6 px-6 py-4">
            {/* Eligibility toggle */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-y-1">
                <Text size="small" leading="compact" weight="plus">
                  Eligible for Engraving
                </Text>
                <Text
                  size="small"
                  leading="compact"
                  className="text-ui-fg-subtle"
                >
                  Apply to all {selectedRows.length} selected variants
                </Text>
              </div>
              <Switch
                checked={form.is_engravable}
                onCheckedChange={(checked) =>
                  setForm((s) => ({
                    ...s,
                    is_engravable: checked,
                  }))
                }
              />
            </div>

            {/* Fee + Threshold (visible when ON) */}
            {form.is_engravable && (
              <>
                <div className="flex flex-col gap-y-1">
                  <Text size="small" leading="compact" weight="plus">
                    Engraving Fee (per unit)
                  </Text>
                  <Text
                    size="small"
                    leading="compact"
                    className="text-ui-fg-subtle"
                  >
                    Charged per engraved item when quantity is below the free
                    threshold
                    {selectedCurrencies.length > 0 &&
                      ` (${selectedCurrencies.join(", ")})`}
                  </Text>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={
                      selectedCurrencies.length === 1
                        ? `e.g. 25.00 ${selectedCurrencies[0]}`
                        : "e.g. 25.00"
                    }
                    value={
                      form.engraving_fee === ""
                        ? ""
                        : String(form.engraving_fee)
                    }
                    onChange={(e) =>
                      setForm((s) => ({
                        ...s,
                        engraving_fee:
                          e.target.value === "" ? "" : Number(e.target.value),
                      }))
                    }
                  />
                </div>

                <div className="flex flex-col gap-y-1">
                  <Text size="small" leading="compact" weight="plus">
                    Free Engraving Threshold (quantity)
                  </Text>
                  <Text
                    size="small"
                    leading="compact"
                    className="text-ui-fg-subtle"
                  >
                    Orders at or above this quantity get free engraving
                  </Text>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="e.g. 10"
                    value={
                      form.engraving_threshold === ""
                        ? ""
                        : String(form.engraving_threshold)
                    }
                    onChange={(e) =>
                      setForm((s) => ({
                        ...s,
                        engraving_threshold:
                          e.target.value === "" ? "" : Number(e.target.value),
                      }))
                    }
                  />
                </div>
              </>
            )}
          </Drawer.Body>
          <Drawer.Footer>
            <div className="flex items-center justify-end gap-x-3">
              <Button
                size="small"
                variant="secondary"
                onClick={() => setDrawerOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="small"
                variant="primary"
                disabled={!canSave || saveMutation.isPending}
                isLoading={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                Apply to {selectedRows.length} variant
                {selectedRows.length !== 1 ? "s" : ""}
              </Button>
            </div>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "product.details.after",
});

export default EngravingBulkWidget;
