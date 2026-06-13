/**
 * Функция для расчета выручки
 * @param purchase запись о покупке
 * @param _product карточка товара
 * @returns {number}
 */
function calculateSimpleRevenue(purchase, _product) {
  // purchase - это одна из записей в поле items из чека в data.purchase_records
  // _product - это продукт из коллекции data.products
  const { discount = 0, sale_price, quantity } = purchase;

  // Ensure discount is between 0 and 100
  const safeDiscount = Math.max(0, Math.min(discount, 100));

  // Discounted selling price per unit
  const discountedPrice = sale_price * (1 - safeDiscount / 100);

  // Revenue from the unit
  const revenue = discountedPrice * quantity;

  return revenue;
}

/**
 * Функция для расчета бонусов
 * @param index порядковый номер в отсортированном массиве
 * @param total общее число продавцов
 * @param seller карточка продавца
 * @returns {number}
 */

function calculateBonusByProfit(index, total, seller) {
  // index - position in sorted list (0 = best)
  // total - total number of sellers
  if (total === 1) return 0;

  const { profit } = seller;

  if (index === 0) {
    return profit * 0.15;
  } else if (index <= 2) {
    return profit * 0.10;
  } else if (index === total - 1) {
    return 0;
  } else {
    return profit * 0.05;
  }
}

/**
 * Функция для анализа данных продаж
 * @param data
 * @param options
 * @returns {{revenue, top_products, bonus, name, sales_count, profit, seller_id}[]}
 */

function analyzeSalesData(data, options) {
  // Validate input data
  if (!data || typeof data !== "object") {
    throw new Error("Отсутствует или невалиден объект data");
  }

  // Validate that required arrays are present and not empty
  const requiredArrays = [
    { key: "sellers", name: "sellers" },
    { key: "products", name: "products" },
    { key: "purchase_records", name: "purchase_records" },
  ];

  for (const { key, name } of requiredArrays) {
    const value = data[key];
    if (!Array.isArray(value)) {
      throw new Error(`Поле ${name} должно быть массивом.`);
    }
    if (value.length === 0) {
      throw new Error(`Массив ${name} не должен быть пустым.`);
    }
  }

  // Validate options
  if (!options || typeof options !== "object") {
    throw new Error("Опции не переданы или имеют неверный формат.");
  }

  const { calculateRevenue, calculateBonus } = options;

  if (
    typeof calculateRevenue !== "function" ||
    typeof calculateBonus !== "function"
  ) {
    throw new Error(
      "Параметры calculateRevenue и calculateBonus должны быть функциями."
    );
  }

  // Indexing sellers: key - seller_id, value - an object with accumulated
  // profit and initial data
  const sellerIndex = new Map();
  const productIndex = new Map();

  data.sellers.forEach(seller => {
    if (!seller || typeof seller.id !== "string") {
      throw new Error("Каждый продавец должен иметь валидный строковый id.");
    }
    sellerIndex.set(seller.id, {
      id: seller.id,
      name: `${seller.first_name} ${seller.last_name}`,
      revenue: 0,
      profit: 0,
      sales_count: 0,
      products_sold: new Map() // key - SKU, value - total quantity sold
    });
  });

  data.products.forEach(product => {
    if (
      (!product && typeof product.sku !== "string") ||
      typeof product.purchase_price !== "number"
    ) {
      throw new Error(
        "Каждый товар должен иметь строковый SKU и числовой purchase_price."
      );
    }
    productIndex.set(product.sku, product);
  });

  // console.log("sellerStats:", sellerStats);

  // Indexing goods by SKU for quick access
  data.purchase_records.forEach((record, recIdx) => {
    if (!record && typeof record.seller_id !== "string") {
      throw new Error(`Чек #${recIdx} не содержит валидного seller_id.`);
    }
    const seller = sellerIndex.get(record.seller_id);
    if (!seller) {
      throw new Error(
        `В чеке #${recIdx} указан продавец с id="${record.seller_id}", которого нет в данных о продавцах.`
      );
    }

    // Counting the number of sales (checks) for the seller
    seller.sales_count += 1;

    if (Array.isArray(record.items)) {
      record.items.forEach((item, itemIdx) => {
        if (
          !item ||
          typeof item.sku !== "string" ||
          typeof item.quantity !== "number" ||
          item.quantity <= 0
        ) {
          throw new Error(
            `Позиция #${itemIdx} в чеке #${recIdx} имеет некорректные данные`
          );
        }
        const product = productIndex.get(item.sku);
        if (!product) {
          throw new Error(
            `Товар с SKU="#${item.sku}" в позиции #${itemIdx}, чек #${recIdx} отсутствует в данных о продуктах.`
          );
        }

        // Revenue calculation for each item in the check
        const revenue = calculateRevenue(item, product);

        // Cost price and profit
        const cost = product.purchase_price * item.quantity;
        const profit = revenue - cost;

        seller.revenue += revenue;
        seller.profit += profit;

        // Accumulate quantity sold for each product
        const currentQuantity = seller.products_sold.get(item.sku) || 0;
        seller.products_sold.set(item.sku, currentQuantity + item.quantity);
      });
    }
  });

  // Convert to an array for sorting
  const resultList = Array.from(sellerIndex.values());

  // Sort sellers by profit in descending order
  resultList.sort((a, b) => b.profit - a.profit);

  const total = resultList.length;

  // Calculate bonuses based on sorted order
  resultList.forEach((seller, index) => {
    const bonusRaw = calculateBonus(index, total, { profit: seller.profit });
    seller.bonus = bonusRaw < 0 ? 0 : bonusRaw;
  });

  // Forming the final result with top 10 products for each seller
  return resultList.map(seller => {
    // Top-10 goods: first by quantity (descending), then by SKU (ascending)
    const topProducts = Array.from(seller.products_sold.entries())
      .map(([sku, quantity]) => ({ sku, quantity }))
      .sort((a, b) => {
        if (b.quantity !== a.quantity) return b.quantity - a.quantity;
        return a.sku.localeCompare(b.sku); // sort by SKU if quantities are equal
      })
      .slice(0, 10);

    const round2 = x => Math.round(x * 100) / 100;

    return {
      seller_id: seller.id,
      name: `${seller.first_name} ${seller.last_name}`,
      revenue: round2(seller.revenue),
      profit: round2(seller.profit),
      sales_count: seller.sales_count,
      top_products: topProducts,
      bonus: round2(seller.bonus),
    };
  });
}
