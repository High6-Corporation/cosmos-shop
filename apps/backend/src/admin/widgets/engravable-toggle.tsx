import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Container, Text, Switch, Input, Button, toast } from "@medusajs/ui";
import type {
  AdminProductVariant,
  DetailWidgetProps,
} from "@medusajs/framework/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { sdk } from "../lib/client";

/**
 * Engraving eligibility toggle widget — per variant.
 *
 * Injected at product_variant.details.after — renders a toggle for "Eligible for
 * Engraving" with additional fee/threshold inputs that appear when toggled ON.
 *
 * Data storage: variant.metadata.is_engravable (boolean),
 *   variant.metadata.engraving_fee (number),
 *   variant.metadata.engraving_threshold (number).
 *
 * Validation: cannot toggle ON without filling both fee and threshold.
 */

interface EngravingState {
  is_engravable: boolean;
  engraving_fee: number | "";
  engraving_threshold: number | "";
  saving: boolean;
}

const EngravableToggleWidget = ({
  data: variant,
}: DetailWidgetProps<AdminProductVariant>) => {
  const queryClient = useQueryClient();

  const metadata = (variant.metadata ?? {}) as Record<string, any>;
  const savedEngravable = !!metadata.is_engravable;
  const savedFee = (metadata.engraving_fee as number) ?? 0;
  const savedThreshold = (metadata.engraving_threshold as number) ?? 0;

  const [state, setState] = useState<EngravingState>({
    is_engravable: savedEngravable,
    engraving_fee: savedEngravable && savedFee > 0 ? savedFee : "",
    engraving_threshold:
      savedEngravable && savedThreshold > 0 ? savedThreshold : "",
    saving: false,
  });

  // Sync state when navigating between variants
  useEffect(() => {
    setState({
      is_engravable: savedEngravable,
      engraving_fee: savedEngravable && savedFee > 0 ? savedFee : "",
      engraving_threshold:
        savedEngravable && savedThreshold > 0 ? savedThreshold : "",
      saving: false,
    });
  }, [variant.id]);

  const canSave =
    !state.is_engravable || // always valid to toggle OFF
    (state.is_engravable &&
      state.engraving_fee !== "" &&
      Number(state.engraving_fee) > 0 &&
      state.engraving_threshold !== "" &&
      Number(state.engraving_threshold) >= 1);

  const saveMutation = useMutation({
    mutationFn: () =>
      sdk.client.fetch(
        `/admin/products/${variant.product_id}/variants/${variant.id}/engravable`,
        {
          method: "POST",
          body: {
            is_engravable: state.is_engravable,
            engraving_fee: state.is_engravable
              ? Number(state.engraving_fee)
              : undefined,
            engraving_threshold: state.is_engravable
              ? Number(state.engraving_threshold)
              : undefined,
          },
        },
      ),
    onMutate: () => setState((s) => ({ ...s, saving: true })),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["product", variant.product_id],
      });
      toast.success("Engraving settings saved");
      setState((s) => ({ ...s, saving: false }));
    },
    onError: (error: any) => {
      const msg =
        (error as any)?.response?.data?.message ??
        (error as any)?.message ??
        "Failed to save engraving settings";
      toast.error(msg);
      setState((s) => ({ ...s, saving: false }));
    },
  });

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col gap-y-1">
          <Text size="small" leading="compact" weight="plus">
            Engraving
          </Text>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Allow customers to add engraving to this variant
          </Text>
        </div>
        <Switch
          checked={state.is_engravable}
          onCheckedChange={(checked) =>
            setState((s) => ({
              ...s,
              is_engravable: checked,
            }))
          }
        />
      </div>

      {state.is_engravable && (
        <div className="flex flex-col gap-y-4 px-6 py-4">
          <div className="flex flex-col gap-y-1">
            <Text size="small" leading="compact" weight="plus">
              Engraving Fee (per unit)
            </Text>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Charged per engraved item when quantity is below the free
              threshold
            </Text>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 25.00"
              value={
                state.engraving_fee === "" ? "" : String(state.engraving_fee)
              }
              onChange={(e) =>
                setState((s) => ({
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
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              Orders at or above this quantity get free engraving
            </Text>
            <Input
              type="number"
              min="1"
              step="1"
              placeholder="e.g. 10"
              value={
                state.engraving_threshold === ""
                  ? ""
                  : String(state.engraving_threshold)
              }
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  engraving_threshold:
                    e.target.value === "" ? "" : Number(e.target.value),
                }))
              }
            />
          </div>

          <div className="flex items-center justify-end gap-x-3">
            <Button
              size="small"
              variant="secondary"
              disabled={state.saving}
              onClick={() =>
                setState((s) => ({
                  ...s,
                  is_engravable: false,
                  engraving_fee: "",
                  engraving_threshold: "",
                }))
              }
            >
              Cancel
            </Button>
            <Button
              size="small"
              variant="primary"
              disabled={!canSave || state.saving}
              isLoading={state.saving}
              onClick={() => saveMutation.mutate()}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "product_variant.details.after",
});

export default EngravableToggleWidget;
