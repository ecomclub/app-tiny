const getCurrentDate = require('./get-date')

module.exports = ({ logger, ecomClient, mysql, getStores, MapStores, appSdk, tinyClient }) => {
  logger.log('>> Orders Manager - OK')

  const manager = () => new Promise(async (resolve, reject) => {
    const callback = async (configObj, storeId, next, current, err) => {
      if (err && storeId) {
        logger.error('OrderManagerErr', { err, storeId })
        return next()
      } else if (!next && !err && !storeId && !configObj) {
        return resolve()
      }

      if (
        !configObj.access_token ||
        !configObj.sync ||
        !configObj.sync.tiny ||
        !configObj.sync.tiny.orderStatus ||
        configObj.sync.tiny.orderStatus === false
      ) {
        return next()
      }

      const token = configObj.access_token
      let pedidos
      try {
        pedidos = await tinyClient({
          url: 'pedidos.pesquisa.php',
          params: {
            dataInicialOcorrencia: getCurrentDate()
          },
          token
        }, true).then(({ pedidos }) => pedidos)
      } catch (error) {
        if (error.code === 6) {
          setTimeout(() => current(), 1 * 60 * 1000)
        }
      }

      if (!pedidos) {
        // nenhum pedido alterado ou algum erro que pode ser ignorado
        return next() // chama a proxima storeId
      }

      // deixando sincrono pra evitar 503 da store-api sometimes 
      const auth = await appSdk.getAuth(storeId)
      const reqConfig = {
        storeId,
        authenticationId: auth.myId,
        accessToken: auth.accessToken
      }

      const updatePaymentHistory = (pedido, orderDb, orderBody) => {
        let req = Promise.resolve()
        if (orderDb.tiny_status.toLowerCase() === pedido.situacao.toLowerCase()) {
          return req
        }

        const parseSituacao = situacao => {
          switch (situacao.toLowerCase()) {
            case 'em aberto': return 'pending'
            case 'aprovado': return 'paid'
            case 'cancelado': return 'voided'
            default: break
          }
          return undefined
        }

        const newStatus = parseSituacao(pedido.situacao)
        if ((newStatus && !orderBody.financial_status) ||
          (newStatus && (orderBody.financial_status.current !== newStatus))) {
          const data = {
            status: newStatus,
            date_time: new Date().toISOString(),
            flags: ['app:tiny', 'ORDERMANAGER']
          }

          req = ecomClient.store({
            ...reqConfig,
            url: `/orders/${orderDb._id}/payments_history.json`,
            method: 'post',
            data
          }).then(() => {
            // atualiza no banco de dados por ultimo
            // se der merda na store-api, pode rolar uma rententativa na prox rotine
            const sql = 'update orders ' +
              'set tiny_status = ?, ecom_status = ?, last_change_by = ?, updated_at = CURRENT_TIMESTAMP() ' +
              'where store_id = ? ' +
              'and _id = ?'
            return mysql.query(sql, [pedido.situacao, newStatus, 'tiny', storeId, orderDb._id])
          })
            .then(() => {
              return {
                number: orderDb.order_number,
                resource: 'payment_history',
                resource_id: orderDb._id,
                data
              }
            })
        }

        return req
      }

      const updateFulfillments = (pedido, orderDb, orderBody) => {
        let req = Promise.resolve()
        if (orderDb.tiny_status.toLowerCase() === pedido.situacao.toLowerCase()) {
          return req
        }

        const parseSituacao = situacao => {
          switch (situacao.toLowerCase()) {
            case 'preparando envio': return 'in_separation'
            case 'faturado (atendido)':
            case 'pronto para envio':
              return 'ready_for_shipping'
            case 'enviado': return 'shipped'
            case 'entregue': return 'delivered'
            default: break
          }
          return undefined
        }

        const newStatus = parseSituacao(pedido.situacao)
        if ((newStatus && !orderBody.fulfillment_status) ||
          (newStatus && !orderBody.fulfillments) ||
          (newStatus && (orderBody.fulfillment_status && orderBody.fulfillment_status.current !== newStatus))) {
          const data = {
            status: newStatus,
            date_time: new Date().toISOString(),
            flags: ['app:tiny', 'ORDERMANAGER']
          }

          req = ecomClient.store({
            ...reqConfig,
            url: `/orders/${orderDb._id}/fulfillments.json`,
            method: 'post',
            data
          }).then(() => {
            // atualiza no banco de dados por ultimo
            // se der merda na store-api, pode rolar uma rententativa na prox rotine
            const sql = 'update orders ' +
              'set tiny_status = ?, ecom_status = ?, last_change_by = ?, updated_at = CURRENT_TIMESTAMP() ' +
              'where store_id = ? ' +
              'and _id = ?'
            return mysql.query(sql, [pedido.situacao, newStatus, 'tiny', storeId, orderDb._id])
          })
            .then(() => {
              return {
                number: orderDb.order_number,
                resource: 'fulfillments',
                resource_id: orderDb._id,
                data
              }
            })
        }

        return req
      }

      const updateTrackingCodes = (pedido, orderDb, orderBody) => {
        let req = Promise.resolve()
        if (pedido.codigo_rastreamento && pedido.codigo_rastreamento !== orderDb.tracking ||
          pedido.url_rastreamento && pedido.url_rastreamento !== orderDb.tracking) {
          const shippingLines = orderBody.shipping_lines.find(shipping => shipping._id)
          const data = {
            tracking_codes: [
              {
                code: String(pedido.codigo_rastreamento || orderDb.order_number),
                tag: 'app_tiny',
                link: pedido.url_rastreamento
              }
            ]
          }

          req = ecomClient.store({
            ...reqConfig,
            url: `/orders/${orderDb._id}/shipping_lines/${shippingLines._id}.json`,
            method: 'patch',
            data
          }).then(() => {
            // atualiza no banco de dados por ultimo
            // se der merda na store-api, pode rolar uma rententativa na prox rotine
            const sql = 'update orders ' +
              'set tracking = ?, updated_at = CURRENT_TIMESTAMP() ' +
              'where store_id = ? ' +
              'and _id = ?'
            return mysql.query(sql, [pedido.codigo_rastreamento || pedido.url_rastreamento, storeId, orderDb._id])
          })
            .then(() => {
              return {
                number: orderDb.order_number,
                resource: 'shipping_lines/tracking_codes',
                resource_id: orderDb._id,
                subresource_id: shippingLines._id,
                data
              }
            })
        }

        return req
      }

      const updateInvoice = (pedido, orderDb, orderBody) => {
        let req = Promise.resolve()
        if (pedido.id_nota_fiscal &&
          pedido.id_nota_fiscal !== '' &&
          pedido.id_nota_fiscal !== '0' &&
          pedido.id_nota_fiscal !== orderDb.invoice) {
          req = tinyClient({
            url: 'nota.fiscal.obter.php',
            params: {
              id: pedido.id_nota_fiscal
            },
            token
          }, true).then(async ({ notaFiscal }) => {
            const linkNf = await tinyClient({
              url: 'nota.fiscal.obter.php',
              params: {
                id: pedido.id_nota_fiscal
              },
              token
            }, true).then(async ({ linkNfe }) => linkNfe)

            const shippingLines = orderBody.shipping_lines.find(shipping => shipping._id)
            const data = {
              invoices: [
                {
                  number: notaFiscal.numero,
                  link: linkNf,
                  access_key: notaFiscal.chave_acesso
                }
              ]
            }

            return ecomClient.store({
              ...reqConfig,
              url: `/orders/${orderDb._id}/shipping_lines/${shippingLines._id}.json`,
              method: 'patch',
              data
            }).then(() => data)
          }).then(data => {
            // atualiza no banco de dados por ultimo
            // se der merda na store-api, pode rolar uma rententativa na prox rotine
            const sql = 'update orders ' +
              'set invoice = ?, updated_at = CURRENT_TIMESTAMP() ' +
              'where store_id = ? ' +
              'and _id = ?'
            return mysql.query(sql, [pedido.id_nota_fiscal, storeId, orderDb._id]).then(() => data)
          }).then(data => {
            return {
              number: orderDb.order_number,
              resource: 'shipping_lines/invoice',
              resource_id: orderDb._id,
              subresource_id: shippingLines._id,
              data
            }
          })
        }

        return req
      }

      const checkPedidos = async (pedidos, queue = 0) => {
        const nextPedido = () => {
          queue++
          checkPedidos(pedidos, queue)
        }

        if (!pedidos[queue]) {
          // chama a proxima storeId quando não houver mais pedidos
          return next()
        }

        try {
          const pedido = await tinyClient({
            url: 'pedido.obter.php',
            params: {
              id: pedidos[queue].id
            },
            token
          }, true).then(({ pedido }) => pedido)
          let orderDb = await mysql.findOrder(pedido.id, pedido.numero_ecommerce, storeId).then(rows => rows)
          if (!orderDb || !orderDb.length) {
            return nextPedido()
          }
          orderDb = orderDb[0]

          const orderBody = await ecomClient.store({
            url: `/orders/${orderDb._id}.json`,
            ...reqConfig
          }).then(({ data }) => data)

          Promise.all([
            updatePaymentHistory(pedido, orderDb, orderBody),
            updateFulfillments(pedido, orderDb, orderBody),
            updateTrackingCodes(pedido, orderDb, orderBody),
            updateInvoice(pedido, orderDb, orderBody)
          ]).then(result => {
            if (result.find(p => p)) {
              logger.log('[order-manager] >>', JSON.stringify(result, undefined, 2))
            }

            nextPedido()
          })
        } catch (err) {
          console.log(err)
          if (err.code === 6) {
            // bateu limite da api de chamadas por minuto
            setTimeout(() => checkPedidos(pedidos, queue), 1 * 60 * 1000)
          } else if (err.code === 20 || err.code === 7) {
            // limite da conta do lojista
            // ou nenhum registro alterado
            return nextPedido()
          } else if (err.response && err.response.status === 503) {
            // store-api ta achando q é ddos
            setTimeout(() => checkPedidos(pedidos, queue), 4000)
          } else if (err.code === 'ECONNABORTED' || err.message.startsWith('Sistema em manuten')) {
            // pra timeout eu dou uma segurada no script
            // ainda mais se for timeout do tiny
            // chamo a proxima loja pra evitar loop pra mesma conta na api
            setTimeout(() => next(), 1 * 60 * 1000)
          } else {
            let erro = {}
            if (err.response) {
              delete err.config.headers
              if (err.response.data) {
                erro.data = err.response.data
              }
              erro.status = err.response.status
              erro.config = err.config
            }
            logger.error('ORDERS_MANAGER_ERR', erro)
          }

          return nextPedido()
        }
      }

      return checkPedidos(pedidos)
    }

    const mp = new MapStores(appSdk)
    const stores = await getStores().catch(reject)
    mp.tasks(stores, callback)
  })

  const orders = () => manager().finally(() => {
    setTimeout(() => orders(), 2 * 60 * 1000)
  })

  orders()
}