export async function getNormalizedBill(biennium, billNumber) {
  console.log("inside adapter", biennium, billNumber);

  return {
    billId: "test-bill-id",
    billNumber,
    title: "Test Bill Title",
    longTitle: "Test Long Title",
    description: "Test Description",
    status: "Test Status"
  };
}

