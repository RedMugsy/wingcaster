export async function createPropertyWithCanonical({
  transaction,
  createProperty,
  createCanonical,
}) {
  return transaction(async () => {
    const property = await createProperty()
    await createCanonical(property.id)
    return property
  })
}
