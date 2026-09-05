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
