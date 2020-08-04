const getCurrentDate = () => {
  const data = new Date()
  const year = data.getFullYear()
  const month = (`00${data.getMonth() + 1}`).slice(-2)
  const day = (`00${data.getDate()}`).slice(-2)
  return `${day}/${month}/${year}`
}

module.exports = ({ logger, ecomClient, mysql, getStores, MapStores, appSdk, tinyClient }) => {
  logger.log('>> Orders Manager - OK')

  const manager = () => {
    return new Promise(async (resolve, reject) => {
      const callback = async function (configObj, storeId, next, current, err) {
        if (err && storeId) {
          return next()
        } else if (!next && !err && !storeId && !configObj) {
          return resolve()
        }

        // stuffs
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

        tinyClient({
          url: 'pedidos.pesquisa.php',
          params: {
            dataInicialOcorrencia: getCurrentDate()
          },
          token
        }, true).then(({ pedidos }) => {
          const promises = []
          for (let i = 0; i < pedidos.length; i++) {
            const pedido = pedidos[i]
            const promise = mysql.findOrder(pedido.id, pedido.numero_ecommerce, storeId).then(async row => {
              if (row && row[0]) {
                const orderDb = row[0]
                const requests = []

                // deixando sincrono pra evitar 503 da store-api sometimes 
                const auth = await appSdk.getAuth(storeId)
                const reqConfig = {
                  storeId,
                  authenticationId: auth.myId,
                  accessToken: auth.accessToken
                }

                const orderBody = await ecomClient.store({
                  url: `/orders/${orderDb._id}.json`,
                  ...reqConfig
                }).then(({ data }) => data)

                // atualiza payment_history
                if (orderDb.tiny_status.toLowerCase() !== pedido.situacao.toLowerCase()) {
                  const parseSituacao = situacao => {
                    switch (situacao) {
                      case 'Em aberto':
                      case 'Faturado (atendido)': return 'pending'
                      case 'Aprovado': return 'paid'
                      case 'Cancelado': return 'voided'
                      default: break
                    }
                    return undefined
                  }

                  const newStatus = parseSituacao(pedido.situacao)
                  if ((orderBody.financial_status && newStatus !== undefined) && (orderBody.financial_status.current !== newStatus)) {
                    const req = ecomClient.store({
                      ...reqConfig,
                      url: `/orders/${orderDb._id}/payments_history.json`,
                      method: 'post',
                      data: {
                        status: newStatus,
                        date_time: new Date().toISOString(),
                        flags: ['app:tiny']
                      }
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
                        return logger.log(`>> Pedido atualizado (payment_history) ${orderDb._id} / #${newStatus} / #${storeId}`)
                      })

                    requests.push(req)
                  }
                }

                // atualiza fultillments
                if (orderDb.tiny_status.toLowerCase() !== pedido.situacao.toLowerCase()) {
                  const parseSituacao = situacao => {
                    switch (situacao) {
                      case 'Pronto para envio': return 'ready_for_shipping'
                      case 'Enviado': return 'shipped'
                      case 'Preparando envio': return 'in_separation'
                      case 'Entregue': return 'delivered'
                      default: break
                    }
                    return undefined
                  }

                  const newStatus = parseSituacao(pedido.situacao)
                  if ((orderBody.financial_status && newStatus !== undefined) && (orderBody.financial_status.current !== newStatus)) {
                    const req = ecomClient.store({
                      ...reqConfig,
                      url: `/orders/${orderDb._id}/fulfillments.json`,
                      method: 'post',
                      data: {
                        status: newStatus,
                        date_time: new Date().toISOString(),
                        flags: ['app:tiny']
                      }
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
                        return logger.log(`>> Pedido atualizado (fulfillments) ${orderDb._id} / #${newStatus} / #${storeId}`)
                      })

                    requests.push(req)
                  }
                }

                // insere codigo de rastreio na order
                if (pedido.codigo_rastreamento &&
                  pedido.codigo_rastreamento !== orderDb.tracking) {
                  const shippingLines = orderBody.shipping_lines.find(shipping => shipping._id)
                  const req = ecomClient.store({
                    ...reqConfig,
                    url: `/orders/${orderDb._id}/shipping_lines/${shippingLines._id}.json`,
                    method: 'patch',
                    data: {
                      tracking_codes: [
                        {
                          code: pedido.codigo_rastreamento,
                          tag: 'app:tiny',
                          link: pedido.url_rastreamento
                        }
                      ]
                    }
                  }).then(() => {
                    // atualiza no banco de dados por ultimo
                    // se der merda na store-api, pode rolar uma rententativa na prox rotine
                    const sql = 'update orders ' +
                      'set tracking = ?, updated_at = CURRENT_TIMESTAMP() ' +
                      'where store_id = ? ' +
                      'and _id = ?'
                    return mysql.query(sql, [pedido.codigo_rastreamento, storeId, orderDb._id])
                  })
                    .then(() => {
                      return logger.log(`>> Pedido atualizado (shipping_lines/tracking_codes) ${orderDb._id} / #${pedido.codigo_rastreamento} / #${storeId}`)
                    })

                  requests.push(req)
                }

                // insere nota fiscal 
                if (pedido.id_nota_fiscal &&
                  pedido.id_nota_fiscal !== '' &&
                  pedido.id_nota_fiscal !== '0' &&
                  pedido.id_nota_fiscal !== orderDb.invoice) {
                  const req = tinyClient({
                    url: 'nota.fiscal.obter.php',
                    params: {
                      id: pedido.id_nota_fiscal
                    },
                    token
                  }, true).then(({ notaFiscal }) => {
                    const shippingLines = orderBody.shipping_lines.find(shipping => shipping._id)
                    return ecomClient.store({
                      ...reqConfig,
                      url: `/orders/${orderDb._id}/shipping_lines/${shippingLines._id}.json`,
                      method: 'patch',
                      data: {
                        invoices: [
                          {
                            number: notaFiscal.numero,
                            link: notaFiscalLink
                          }
                        ]
                      }
                    })
                  }).then(() => {
                    // atualiza no banco de dados por ultimo
                    // se der merda na store-api, pode rolar uma rententativa na prox rotine
                    const sql = 'update orders ' +
                      'set invoice = ?, updated_at = CURRENT_TIMESTAMP() ' +
                      'where store_id = ? ' +
                      'and _id = ?'
                    return mysql.query(sql, [pedido.id_nota_fiscal, storeId, orderDb._id])
                  }).then(() => {
                    return logger.log(`>> Pedido atualizado (shipping_lines/invoices) ${orderDb._id}/ #${pedido.id_nota_fiscal} / #${storeId}`)
                  }).catch(err => {
                    // fod*s
                    console.log('Erro ao consultar a nota fiscal, fica pra proxima.', err)
                  })

                  requests.push(req)
                }

                // 
                return Promise.all(requests)
              }
              return false
            })

            promises.push(promise)
          }

          return Promise.all(promises)
        })
          .then(result => {
            next()
          })
          .catch(err => {
            console.log(err.message)
            if (err.code === 6) {
              console.log('WAIT! API LIMIT, AGAIN :(')
              setTimeout(() => {
                // wait 1m and try to sync current order again 🙏
                return current()
              }, 1 * 60 * 1000)
            } else if (err.code === 20) {
              // nenhum registro alterado, bye
              return next()
            } else if (err.response && err.response.status === 503) {
              console.log('store-api ta achando que é ddos kk')
              setTimeout(() => {
                // wait 1m and try to sync current order again 🙏
                return current()
              }, 4000)
            } else {
              logger.error('ORDERS_MANAGER_ERR', err)
              next()
            }
          })
      }

      const mp = new MapStores(appSdk)
      const stores = await getStores().catch(reject)
      mp.tasks(stores, callback)
    })
  }

  const orders = () => manager().finally(() => {
    setTimeout(() => {
      return orders()
    }, 5 * 60 * 1000)
  })

  orders()
}