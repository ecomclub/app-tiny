const getCurrentDate = require('./get-date')

module.exports = ({ logger, ecomClient, mysql, getStores, MapStores, appSdk, tinyClient }) => {
  logger.log('>> Controle de estoque iniciado')

  const manager = () => new Promise(async (resolve, reject) => {
    const callback = async (configObj, storeId, next, current, err) => {
      logger.log(`>> [stock-manager] Iniciado para #${storeId}`)
      if (err && storeId) {
        logger.error('stock-managerErr', { err, storeId })
        return next()
      } else if (!next && !err && !storeId && !configObj) {
        return resolve()
      }

      // stuffs
      if (
        !configObj.access_token ||
        !configObj.sync ||
        !configObj.sync.tiny ||
        !configObj.sync.tiny.stock ||
        configObj.sync.tiny.stock === false
      ) {
        return next()
      }

      const token = configObj.access_token
      let produtos
      try {
        produtos = await tinyClient({
          url: 'lista.atualizacoes.estoque',
          params: {
            dataAlteracao: getCurrentDate()
          },
          token
        }, true).then(({ produtos }) => produtos)
      } catch (error) {
        if (error.code === 6) {
          // limit api
          setTimeout(() => current(), 1 * 60 * 1000)
        }
      }
      console.log('produtos', produtos)
      if (!produtos) {
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

      const promises = []
      for (let i = 0; i < produtos.length; i++) {
        const { codigo, saldo } = produtos[i]
        const promise = mysql.fetchProduct(codigo, storeId).then(async row => {
          // alterou o produto
          let url
          let fn = null
          let produto = row && row[0]
          let isVariation = false
          if (produto) {
            if (produto.quantity !== saldo) {
              url = `/products/${produto.ecomplus_id}.json`
              fn = mysql.updateProductQty(codigo, storeId, saldo, 'tiny')
            }
          } else {
            // alterou foi a variação?
            await mysql.fetchVariations(codigo, storeId).then(rows => {
              let variation = rows && rows[0]
              if (variation) {
                isVariation = true
                if (variation.quantity !== saldo) {
                  url = `/products/${variation.parent_id}/variations/${variation._id}.json`
                  fn = mysql.updateVariations(codigo, storeId, saldo, 'tiny')
                }
              }
            })
          }

          const syncStockWithEcom = (retry = 0) => {
            const data = {
              quantity: saldo < 0 ? 0 : saldo,
              notes: 'Estoque atualizado via Tiny em: ' + new Date().toLocaleDateString('pt-br')
            }

            if (isVariation) {
              delete data.notes
            }

            return ecomClient.store({
              ...reqConfig,
              url,
              method: 'patch',
              data
            }).then(fn) // atualiza db
              .then(() => { 
                return {
                  resource: url,
                  data,
                  sku: codigo,
                  storeId
                }
              })
              .catch(err => {
                // store err?
                const payload = {}
                if (err.response) {
                  const { response } = err
                  if (response.status >= 500) {
                    if (retry <= 4) {
                      setTimeout(() => {
                        retry++
                        return syncStockWithEcom(retry)
                      }, 3000);
                    }
                  } else {
                    delete err.config.headers
                    if (err.response.data) {
                      payload.data = err.response.data
                    }
                    payload.status = err.response.status
                    payload.config = err.config
                  }
                }

                logger.error('[stock-manager] >> Erro inesperado store-api', err)
              })
          }

          if (url) {
            return syncStockWithEcom()
          }

          return null
        })

        promises.push(promise)
      }

      Promise.all(promises).then(result => {
        if (result) {
          logger.log('[stock-manager]', JSON.stringify(result, undefined, 2))
        }

        // prox loja
        next()
      })
    }

    const mp = new MapStores(appSdk)
    const stores = await getStores().catch(reject)
    mp.tasks(stores, callback)
  })

  const stock = () => manager().finally(() => {
    setTimeout(() => stock(), 1 * 60 * 1000)
  })

  stock()
}