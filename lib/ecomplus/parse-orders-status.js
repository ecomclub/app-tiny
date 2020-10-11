module.exports = status => {
  switch (status) {
    case 'pending':
    case 'under_analysis':
    case 'unknown':
    case 'partially_paid':
    case 'authorized':
      return 'Em aberto'
    case 'paid':
      return 'Aprovado'
    case 'voided':
    case 'refunded':
    case 'in_dispute':
    case 'partially_refunded':
      return 'Cancelado'
    default: return ''
  }
}
