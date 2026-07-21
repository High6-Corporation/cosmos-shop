"use client"

import { Table, Text, clx } from "@modules/common/components/ui"
import { updateLineItem } from "@lib/data/cart"
import { convertToLocale } from "@lib/util/money"
import { HttpTypes } from "@medusajs/types"
import CartItemSelect from "@modules/cart/components/cart-item-select"
import ErrorMessage from "@modules/checkout/components/error-message"
import DeleteButton from "@modules/common/components/delete-button"
import LineItemOptions from "@modules/common/components/line-item-options"
import LineItemPrice from "@modules/common/components/line-item-price"
import LineItemUnitPrice from "@modules/common/components/line-item-unit-price"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Spinner from "@modules/common/icons/spinner"
import Thumbnail from "@modules/products/components/thumbnail"
import { useState } from "react"

type ItemProps = {
  item: HttpTypes.StoreCartLineItem
  type?: "full" | "preview"
  currencyCode: string
}

const Item = ({ item, type = "full", currencyCode }: ItemProps) => {
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [engravedText, setEngravedText] = useState(
    (item.metadata?.engraved_text as string) ?? "",
  )

  const isEngraved =
    item.metadata?.engraved === true || item.metadata?.engraved === "true"

  const changeQuantity = async (quantity: number) => {
    setError(null)
    setUpdating(true)

    await updateLineItem({
      lineId: item.id,
      quantity,
    })
      .catch((err) => {
        setError(err.message)
      })
      .finally(() => {
        setUpdating(false)
      })
  }

  const handleEngravedTextChange = async (text: string) => {
    setEngravedText(text)

    // Persist to line-item metadata (debounced effect could be added later)
    await updateLineItem({
      lineId: item.id,
      quantity: item.quantity,
      metadata: { ...item.metadata, engraved_text: text },
    }).catch(() => {
      // Silently fail — user can re-type
    })
  }

  // TODO: Update this to grab the actual max inventory
  const maxQtyFromInventory = 10
  const maxQuantity = item.variant?.manage_inventory ? 10 : maxQtyFromInventory

  return (
    <Table.Row className="w-full" data-testid="product-row">
      <Table.Cell className="!pl-0 p-4 w-24">
        <LocalizedClientLink
          href={`/products/${item.product_handle}`}
          className={clx("flex", {
            "w-16": type === "preview",
            "small:w-24 w-12": type === "full",
          })}
        >
          <Thumbnail
            thumbnail={item.thumbnail}
            images={
              item.variant?.images?.length
                ? item.variant.images
                : item.variant?.product?.images
            }
            size="square"
          />
        </LocalizedClientLink>
      </Table.Cell>

      <Table.Cell className="text-left">
        <Text
          className="txt-medium-plus text-ui-fg-base"
          data-testid="product-title"
        >
          {item.product_title}
        </Text>
        <LineItemOptions variant={item.variant} data-testid="product-variant" />
        {type === "full" && isEngraved && (
          <div className="mt-2">
            <label className="block text-xs font-medium text-ui-fg-muted mb-1">
              Engraving text <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={engravedText}
              onChange={(e) => handleEngravedTextChange(e.target.value)}
              placeholder="Enter text to engrave..."
              className="w-full max-w-xs rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900"
              data-testid="engraved-text-input"
            />
          </div>
        )}
      </Table.Cell>

      {type === "full" && (
        <Table.Cell>
          <div className="flex gap-2 items-center w-28">
            <DeleteButton id={item.id} data-testid="product-delete-button" />
            <CartItemSelect
              value={item.quantity}
              onChange={(value) => changeQuantity(parseInt(value.target.value))}
              className="w-14 h-10 p-4"
              data-testid="product-select-button"
            >
              {/* TODO: Update this with the v2 way of managing inventory */}
              {Array.from(
                {
                  length: Math.min(maxQuantity, 10),
                },
                (_, i) => (
                  <option value={i + 1} key={i}>
                    {i + 1}
                  </option>
                ),
              )}

              <option value={1} key={1}>
                1
              </option>
            </CartItemSelect>
            {updating && <Spinner />}
          </div>
          <ErrorMessage error={error} data-testid="product-error-message" />
        </Table.Cell>
      )}

      {type === "full" && (
        <Table.Cell className="hidden small:table-cell">
          <LineItemUnitPrice
            item={item}
            style="tight"
            currencyCode={currencyCode}
          />
          {isEngraved &&
            (() => {
              const feePerUnit =
                Number(item.variant?.metadata?.engraving_fee) || 0
              const threshold =
                Number(item.variant?.metadata?.engraving_threshold) || 0
              const unitPrice = item.unit_price ?? 0
              const isFree = threshold > 1 && item.quantity >= threshold
              // When fee is waived (at threshold), unitPrice IS the base price
              // (the subscriber doesn't add the fee). Only subtract in the
              // under-threshold case where the fee was actually applied.
              const basePrice = isFree
                ? unitPrice
                : feePerUnit > 0
                  ? unitPrice - feePerUnit
                  : unitPrice

              return (
                <p
                  className="text-xs text-ui-fg-muted mt-0.5 max-w-[160px]"
                  data-testid="engraved-price-breakdown"
                >
                  {isFree ? (
                    <>
                      {convertToLocale({
                        amount: basePrice,
                        currency_code: currencyCode,
                      })}{" "}
                      +{" "}
                      {convertToLocale({
                        amount: 0,
                        currency_code: currencyCode,
                      })}{" "}
                      engraving{" "}
                      <span className="text-green-600">
                        (free at {threshold}+)
                      </span>{" "}
                      ={" "}
                      {convertToLocale({
                        amount: basePrice,
                        currency_code: currencyCode,
                      })}
                      /unit
                    </>
                  ) : (
                    <>
                      {convertToLocale({
                        amount: basePrice,
                        currency_code: currencyCode,
                      })}{" "}
                      +{" "}
                      {convertToLocale({
                        amount: feePerUnit,
                        currency_code: currencyCode,
                      })}{" "}
                      engraving ={" "}
                      {convertToLocale({
                        amount: unitPrice,
                        currency_code: currencyCode,
                      })}
                      /unit
                    </>
                  )}
                </p>
              )
            })()}
        </Table.Cell>
      )}

      <Table.Cell className="!pr-0">
        <span
          className={clx("!pr-0", {
            "flex flex-col items-end h-full justify-center": type === "preview",
          })}
        >
          {type === "preview" && (
            <span className="flex gap-x-1 ">
              <Text className="text-ui-fg-muted">{item.quantity}x </Text>
              <LineItemUnitPrice
                item={item}
                style="tight"
                currencyCode={currencyCode}
              />
            </span>
          )}
          <LineItemPrice
            item={item}
            style="tight"
            currencyCode={currencyCode}
          />
          {type === "full" &&
            isEngraved &&
            (() => {
              const unitPrice = item.unit_price ?? 0
              const quantity = item.quantity ?? 0
              const lineTotal = item.total ?? unitPrice * quantity

              return (
                <p
                  className="text-[10px] text-ui-fg-muted mt-0.5 whitespace-nowrap"
                  data-testid="engraved-line-total-breakdown"
                >
                  {convertToLocale({
                    amount: unitPrice,
                    currency_code: currencyCode,
                  })}{" "}
                  × {quantity} ={" "}
                  {convertToLocale({
                    amount: lineTotal,
                    currency_code: currencyCode,
                  })}
                </p>
              )
            })()}
        </span>
      </Table.Cell>
    </Table.Row>
  )
}

export default Item
