const tinyErrors = require('./errors-message')

module.exports = response => {
  const { retorno } = response.data
  const { registros, produtos, pedidos, produto, pedido } = retorno
  const statusProcessamento = parseInt(retorno.status_processamento)

  if (statusProcessamento <= 2) {
    let errorCode
    if (retorno.codigo_erro) {
      errorCode = parseInt(retorno.codigo_erro)
    }

    let tinyError
    if (Array.isArray(registros) && registros.length) {
      const { registro } = registros[0]
      const { erros } = registros
      errorCode = parseInt(registro.codigo_erro)
      tinyError = Array.isArray(erros) ? erros[0].erro : null
    } else if (typeof registros === 'object' && registros.registro) {
      const { registro } = registros
      errorCode = parseInt(registro.codigo_erro)
      tinyError = registro && registro.erros ? registro.erros.erro : null
    }

    const errors = new Error(tinyErrors(errorCode))
    errors.tinyError = tinyError || null
    errors.resp = response
    errors.code = errorCode
    errors.isTinyError = true
    errors.retorno = retorno
    throw errors
  }

  const payload = {}
  // response with registros in body
  if (registros && Array.isArray(registros)) {
    payload.registro = registros[0].registro
  } else if (registros && typeof registros === 'object' && registros.registro) {
    payload.registro = registros.registro
  }

  // payload with produtos in body
  if (produtos && Array.isArray(produtos)) {
    payload.produtos = produtos.map(produto => produto.produto)
  }

  if (produto && typeof produto === 'object') {
    payload.produto = produto
  }

  // payload with pedido in body
  if (pedidos && Array.isArray(pedidos)) {
    payload.pedidos = pedidos.map(pedido => pedido.pedido)
  }

  if (pedido && typeof pedido === 'object') {
    payload.pedido = pedido
  }

  if (retorno.nota_fiscal) {
    payload.notaFiscal = retorno.nota_fiscal
  }
  
  if (retorno.link_nfe) {
    payload.linkNfe = retorno.link_nfe
  }

  return {
    ...payload,
    ...response,
    statusProcessamento
  }
}
