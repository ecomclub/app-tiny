module.exports = () => {
  const data = new Date()
  const year = data.getFullYear()
  const month = (`00${data.getMonth() + 1}`).slice(-2)
  const day = (`00${data.getDate()}`).slice(-2)
  return `${day}/${month}/${year}`
}