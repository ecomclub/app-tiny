const parseOrderStatus = require('./../ecomplus/parse-orders-status')
const { fullName, formatDate } = require('@ecomplus/utils')

module.exports = (order, appConfig) => {
  const buyers = order.buyers ? order.buyers[0] : {}
  const transactions = order.transactions ? order.transactions[0] : {}
  const shippingLines = order.shipping_lines ? order.shipping_lines[0] : {}
  const financialStatus = order.financial_status ? order.financial_status.current : ''
  const address = shippingLines.to || {}
  const payload = {
    pedido: {
      data_pedido: formatDate(order.created_at, 'pt-br'),
      obs_internas: order.number || order._id,
      cliente: {
        codigo: buyers._id,
        nome: fullName(buyers),
        tipo_pessoa: buyers.registry_type && buyers.registry_type.toLowerCase() === 'p' ? 'F' : 'J',
        cpf_cnpj: buyers.doc_number,
        endereco: address.street || '',
        numero: address.number || '',
        bairro: address.borough || '',
        cep: address.zip || '',
        cidade: address.city || '',
        uf: address.province_code || '',
        fone: buyers.phones ? buyers.phones[0].number : '',
        email: buyers.main_email,
        complemento: address.complement || '',
        atualizar_cliente: 'S'
      },
      itens: [],
      nome_transportador: shippingLines.app ? shippingLines.app.carrier : '',
      forma_pagamento: paymentMethod(transactions),
      valor_frete: shippingLines.total_price,
      valor_desconto: shippingLines.discount || 0,
      numero_pedido_ecommerce: order.number,
      situacao: parseOrderStatus(financialStatus),
      forma_frete: order.shipping_method_label
    }
  }

  if (Boolean(appConfig.remove_valor_frete)) {
    payload.pedido.valor_frete = 0
  }

  if (order.items) {
    order.items.forEach(item => {
      payload.pedido.itens.push({
        item: {
          codigo: item.sku,
          descricao: item.name,
          unidade: 'UN',
          quantidade: item.quantity,
          valor_unitario: item.final_price || item.price
        }
      })
    })
  }

  if (shippingLines && shippingLines.app && shippingLines.app.carrier) {
    switch (shippingLines.app.carrier.toLowerCase()) {
      case 'correios':
        payload.pedido.forma_envio = 'C'
        break
      case 'jadlog':
      case 'jamef':
      case 'flash courier':
      case 'rodonaves':
      case 'tnt':
      case 'total express':
      case 'b2log':
      case 'loggi':
        payload.pedido.forma_envio = 'T'
        break
      default:
        payload.pedido.forma_envio = 'X'
    }                            
  }

  return payload
}

const paymentMethod = transaction => {
  const pm = transaction ? transaction.payment_method : {}
  if (pm) {
    if (pm.code === 'credit_card') {
      return 'Credito'
    } else if (pm.code === 'banking_billet') {
      return 'Boleto'
    } else {
      return ''
    }
  } else {
    return ''
  }
}
