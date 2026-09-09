/**
 * Shared payload shape for `orders.json` and `orders.avro` (docker-compose
 * plan, phase 2). Deliberately matches the nested paths spec §6.4 and §9 use
 * as `@filter:` examples (`order.items[].sku`, `order.customer.address.zip`,
 * `roles[] contains "admin"`) so those queries have real data to test against
 * once the filter language lands in phase 5.
 */

export interface OrderEvent {
  orderId: string
  createdAt: string
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled"
  total: number
  currency: string
  customer: {
    id: string
    name: string
    roles: string[]
    address: {
      street: string
      city: string
      state: string
      zip: string
      country: string
    }
  }
  items: Array<{
    sku: string
    name: string
    quantity: number
    price: number
  }>
  metadata: {
    retryCount: number
    source: string
  }
}

/** Avro schema for the same shape. No unions/optionals — every field always present. */
export const ORDER_AVRO_SCHEMA = {
  type: "record",
  name: "OrderEvent",
  namespace: "com.kafkatui.orders",
  fields: [
    { name: "orderId", type: "string" },
    { name: "createdAt", type: "string" },
    {
      name: "status",
      type: {
        type: "enum",
        name: "OrderStatus",
        symbols: ["pending", "processing", "shipped", "delivered", "cancelled"],
      },
    },
    { name: "total", type: "double" },
    { name: "currency", type: "string" },
    {
      name: "customer",
      type: {
        type: "record",
        name: "Customer",
        fields: [
          { name: "id", type: "string" },
          { name: "name", type: "string" },
          { name: "roles", type: { type: "array", items: "string" } },
          {
            name: "address",
            type: {
              type: "record",
              name: "Address",
              fields: [
                { name: "street", type: "string" },
                { name: "city", type: "string" },
                { name: "state", type: "string" },
                { name: "zip", type: "string" },
                { name: "country", type: "string" },
              ],
            },
          },
        ],
      },
    },
    {
      name: "items",
      type: {
        type: "array",
        items: {
          type: "record",
          name: "OrderItem",
          fields: [
            { name: "sku", type: "string" },
            { name: "name", type: "string" },
            { name: "quantity", type: "int" },
            { name: "price", type: "double" },
          ],
        },
      },
    },
    {
      name: "metadata",
      type: {
        type: "record",
        name: "OrderMetadata",
        fields: [
          { name: "retryCount", type: "int" },
          { name: "source", type: "string" },
        ],
      },
    },
  ],
}

const STATUSES: OrderEvent["status"][] = ["pending", "processing", "shipped", "delivered", "cancelled"]
const SOURCES = ["web", "mobile-ios", "mobile-android", "api", "pos"]
const CITIES = [
  { city: "Seattle", state: "WA", zip: "98101" },
  { city: "Austin", state: "TX", zip: "73301" },
  { city: "Chicago", state: "IL", zip: "60601" },
  { city: "Boston", state: "MA", zip: "02108" },
  { city: "Denver", state: "CO", zip: "80014" },
]
const SKUS = [
  { sku: "WIDGET-001", name: "Widget" },
  { sku: "GADGET-042", name: "Gadget" },
  { sku: "GIZMO-777", name: "Gizmo" },
  { sku: "DOOHICKEY-13", name: "Doohickey" },
  { sku: "THINGAMAJIG-9", name: "Thingamajig" },
]

function randomInt(max: number): number {
  return Math.floor(Math.random() * max)
}

function pick<T>(items: readonly T[]): T {
  const item = items[randomInt(items.length)]
  if (item === undefined) throw new Error("pick from empty array")
  return item
}

/** A customer's key is stable-ish across orders so the same partition key recurs (realistic skew). */
export function randomCustomerId(poolSize = 200): string {
  return `cust-${randomInt(poolSize)}`
}

export function randomOrderEvent(customerId: string): OrderEvent {
  const location = pick(CITIES)
  const roll = Math.random()
  // Mostly plain customers; a "vip" is fairly common, "admin" is rare — both
  // exercise the `roles[] contains "admin"` filter example from spec §6.4.
  const roles = roll > 0.97 ? ["customer", "admin"] : roll > 0.8 ? ["customer", "vip"] : ["customer"]

  const itemCount = 1 + randomInt(4)
  const items = Array.from({ length: itemCount }, () => {
    const product = pick(SKUS)
    const quantity = 1 + randomInt(3)
    return { ...product, quantity, price: Number((5 + Math.random() * 195).toFixed(2)) }
  })

  return {
    orderId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: pick(STATUSES),
    total: Number(items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)),
    currency: "USD",
    customer: {
      id: customerId,
      name: `Customer ${customerId}`,
      roles,
      address: {
        street: `${100 + randomInt(9000)} Main St`,
        city: location.city,
        state: location.state,
        zip: location.zip,
        country: "US",
      },
    },
    items,
    metadata: {
      // Occasionally high, to exercise `metadata.retryCount > 3` from spec §6.4.
      retryCount: Math.random() > 0.9 ? 4 + randomInt(6) : randomInt(3),
      source: pick(SOURCES),
    },
  }
}

export interface LargeLineItem {
  lineId: string
  sku: string
  name: string
  description: string
  quantity: number
  unitPrice: number
  discountPct: number
  taxCode: string
  warehouse: string
  lotNumbers: string[]
  attributes: {
    color: string
    size: string
    weightGrams: number
    dimensions: { l: number; w: number; h: number }
  }
}

/** Object returned by `randomLargeOrderEvent` — the familiar order shape plus a bulky line-item array. */
export type LargeOrderEvent = OrderEvent & {
  batchId: string
  generatedAt: string
  lineItems: LargeLineItem[]
}

const WAREHOUSES = ["us-east-1a", "us-east-1b", "eu-west-1a", "ap-south-1a", "us-west-2c"]
const COLORS = ["obsidian", "sand", "moss", "cobalt", "crimson", "ivory", "slate", "amber"]
const SIZES = ["XS", "S", "M", "L", "XL", "XXL"]
const TAX_CODES = ["STD-20", "RED-05", "ZERO-00", "EXEMPT", "DIGITAL-15"]
const DESCRIPTION_FRAGMENTS = [
  "precision-machined aluminium housing",
  "impact-resistant polymer shell",
  "recycled-content packaging",
  "field-replaceable battery module",
  "calibrated to ISO 17025 tolerances",
  "ships with a two-year limited warranty",
  "compatible with the previous-generation mount",
  "includes a spare gasket set and hex key",
  "surface-treated for salt-spray resistance",
  "individually serialised for traceability",
]

function randomLargeLineItem(): LargeLineItem {
  const product = pick(SKUS)
  const descriptionParts = Array.from({ length: 3 + randomInt(4) }, () => pick(DESCRIPTION_FRAGMENTS))
  return {
    lineId: crypto.randomUUID(),
    sku: product.sku,
    name: product.name,
    description: `${product.name}: ${descriptionParts.join("; ")}.`,
    quantity: 1 + randomInt(20),
    unitPrice: Number((5 + Math.random() * 495).toFixed(2)),
    discountPct: Math.random() > 0.7 ? Number((Math.random() * 0.3).toFixed(3)) : 0,
    taxCode: pick(TAX_CODES),
    warehouse: pick(WAREHOUSES),
    lotNumbers: Array.from({ length: 3 }, () => crypto.randomUUID()),
    attributes: {
      color: pick(COLORS),
      size: pick(SIZES),
      weightGrams: 50 + randomInt(5000),
      dimensions: { l: 1 + randomInt(200), w: 1 + randomInt(200), h: 1 + randomInt(200) },
    },
  }
}

/**
 * A deliberately large order event for `orders.large` — the same nested shape as
 * `randomOrderEvent` plus a `lineItems` array grown until the serialized JSON
 * reaches `targetBytes` (default caller passes ~300 KB). Arrays-of-objects, not
 * one giant string, so the TUI's JSON tokenizer and detail scrollbox get
 * realistic structural work.
 */
export function randomLargeOrderEvent(targetBytes: number): LargeOrderEvent {
  const customerId = randomCustomerId()
  const event: LargeOrderEvent = {
    ...randomOrderEvent(customerId),
    batchId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    lineItems: [],
  }

  // Grow in small batches, re-measuring between them, rather than stringifying
  // the whole (growing) event on every single push — that's quadratic and this
  // runs on a timer. The 50k cap stops a misconfigured huge target spinning.
  const BATCH = 20
  for (let i = 0; i < 50_000 && JSON.stringify(event).length < targetBytes; i += BATCH) {
    for (let j = 0; j < BATCH; j++) event.lineItems.push(randomLargeLineItem())
  }
  return event
}

const LOG_LEVELS = ["INFO", "WARN", "ERROR", "DEBUG"] as const
const LOG_TEMPLATES = [
  (id: string) => `order ${id} processed successfully in ${20 + randomInt(400)}ms`,
  (id: string) => `payment authorization for order ${id} succeeded`,
  (id: string) => `inventory reserved for order ${id}`,
  (id: string) => `retrying downstream call for order ${id}, attempt ${1 + randomInt(3)}`,
  (id: string) => `order ${id} shipment label generated`,
  (id: string) => `webhook delivery for order ${id} failed with status ${pick([429, 500, 503])}`,
]

/** Plain-text log line for `logs.text` — exercises the non-JSON/non-Avro decode fallback. */
export function randomLogLine(): string {
  const level = pick(LOG_LEVELS)
  const orderId = crypto.randomUUID().slice(0, 8)
  const message = pick(LOG_TEMPLATES)(orderId)
  return `${new Date().toISOString()} [${level}] ${message}`
}
